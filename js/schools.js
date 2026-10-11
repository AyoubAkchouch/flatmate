// Official school data, fetched live.
//  • French institutions recognised by the higher-education ministry (data.enseignementsup-recherche.gouv.fr),
//    with the GPS position of their main site. Updated by the ministry; no key needed.
//  • Universities worldwide from the Research Organization Registry (ror.org), for home universities
//    and for French schools the ministry list doesn't include (many private schools).
//  • Addresses: the French national geocoder (IGN Géoplateforme) for France, and Photon
//    (photon.komoot.io, OpenStreetMap data) everywhere else, to pin a flat or a campus.

const MINISTRY = "https://data.enseignementsup-recherche.gouv.fr/api/explore/v2.1/catalog/datasets/fr-esr-principaux-etablissements-enseignement-superieur/records";
const ROR = "https://api.ror.org/v2/organizations";
const GEO = "https://data.geopf.fr/geocodage/search";
const PHOTON = "https://photon.komoot.io/api/";
const enc = encodeURIComponent;
const quote = (s) => String(s).replace(/["\\]/g, " ").trim();

async function getJSON(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("The school list is not responding right now. Try again in a moment.");
  return r.json();
}
const rorName = (i) => (i.names.find((n) => n.types.includes("ror_display")) || i.names[0]).value;

// Home university, anywhere in the world.
export async function searchHomeUniversities(text) {
  if (text.trim().length < 2) return [];
  const j = await getJSON(`${ROR}?query=${enc(text)}&filter=types:education`);
  return (j.items || []).slice(0, 8).map((i) => {
    const g = i.locations?.[0]?.geonames_details || {};
    return { name: rorName(i), detail: [g.name, g.country_name].filter(Boolean).join(", "), ror: i.id };
  });
}

// Destination school: French institutions from the ministry list first (with a GPS position),
// then universities anywhere from the worldwide registry (those need a campus address).
export async function searchDestinationSchools(text) {
  const t = quote(text);
  if (t.length < 2) return [];
  const where = `search(uo_lib, "${t}") or search(sigle, "${t}") or search(nom_court, "${t}")`;
  const [ministry, ror] = await Promise.all([
    getJSON(`${MINISTRY}?limit=8&select=uo_lib,sigle,com_nom,coordonnees,identifiant_ror&where=${enc(where)}`).catch(() => ({ results: [] })),
    getJSON(`${ROR}?query=${enc(t)}&filter=types:education`).catch(() => ({ items: [] })),
  ]);
  const out = (ministry.results || []).map((r) => ({
    name: r.uo_lib, detail: r.com_nom || "", source: "ministry",
    lat: r.coordonnees?.lat ?? null, lng: r.coordonnees?.lon ?? null,
    ror: (r.identifiant_ror || [])[0] || null,
  }));
  const known = new Set(out.map((o) => o.ror).filter(Boolean));
  for (const i of (ror.items || []).slice(0, 8)) {
    const id = i.id.replace("https://ror.org/", "");
    if (known.has(id)) continue;
    const g = i.locations?.[0]?.geonames_details || {};
    // The registry only knows the city, so these schools need a campus address for travel times.
    out.push({ name: rorName(i), detail: [g.name, g.country_name].filter(Boolean).join(", "), source: "registry", lat: null, lng: null, ror: id, city: g.name || null });
  }
  return out.slice(0, 10);
}

// Recognised institutions near a point (for "close to" on each flat).
export async function schoolsNear(lat, lng, km = 4, limit = 5) {
  if (lat == null || lng == null) return [];
  const pt = `geom'POINT(${lng} ${lat})'`;
  const j = await getJSON(`${MINISTRY}?limit=${limit}&select=uo_lib,com_nom,coordonnees&order_by=${enc(`distance(coordonnees, ${pt})`)}&where=${enc(`within_distance(coordonnees, ${pt}, ${km}km)`)}`);
  return (j.results || []).map((r) => ({ name: r.uo_lib, lat: r.coordonnees.lat, lng: r.coordonnees.lon }));
}

// Address search anywhere: the French geocoder for French addresses, Photon for the rest.
export async function searchAddresses(text) {
  if (text.trim().length < 3) return [];
  const [fr, world] = await Promise.all([
    getJSON(`${GEO}?q=${enc(text)}&autocomplete=1&limit=5`).catch(() => ({ features: [] })),
    getJSON(`${PHOTON}?q=${enc(text)}&limit=6&lang=en`).catch(() => ({ features: [] })),
  ]);
  const out = (fr.features || []).filter((f) => f.properties.score > 0.55).map((f) => ({
    name: f.properties.label, detail: f.properties.context || "France", city: f.properties.city || null, country: "France",
    lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] }));
  const near = (a, b) => Math.abs(a.lat - b.lat) < 0.0005 && Math.abs(a.lng - b.lng) < 0.0005;
  for (const f of world.features || []) {
    const p = f.properties;
    const street = [p.housenumber, p.street].filter(Boolean).join(" ");
    const place = { name: [street || p.name, [p.postcode, p.city || p.town || p.village].filter(Boolean).join(" ")].filter(Boolean).join(", "),
      detail: [p.state, p.country].filter(Boolean).join(", "), city: p.city || p.town || p.village || null, country: p.country || null,
      lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] };
    if (place.name && !out.some((o) => near(o, place))) out.push(place);
  }
  return out.slice(0, 8);
}

// A text box with live suggestions. onPick(item) is called when a suggestion is chosen.
export function autocomplete(input, search, onPick, render = (i) => `<strong>${escHTML(i.name)}</strong>${i.detail ? `<span>${escHTML(i.detail)}</span>` : ""}`) {
  const box = document.createElement("div");
  box.className = "suggest-box";
  box.hidden = true;
  box.setAttribute("role", "listbox");
  input.setAttribute("autocomplete", "off");
  input.parentElement.style.position = "relative";
  input.insertAdjacentElement("afterend", box);
  let timer = null, items = [], seq = 0, active = -1;
  const close = () => { box.hidden = true; active = -1; };
  const draw = (msg) => {
    box.innerHTML = msg ? `<div class="suggest-msg">${escHTML(msg)}</div>`
      : items.map((it, i) => `<button type="button" role="option" data-i="${i}" class="${i === active ? "on" : ""}">${render(it)}</button>`).join("");
    box.hidden = false;
    box.querySelectorAll("button").forEach((b) => b.addEventListener("mousedown", (e) => { e.preventDefault(); pick(+b.dataset.i); }));
  };
  const pick = (i) => { const it = items[i]; if (!it) return; input.value = it.name; close(); onPick(it); };
  input.addEventListener("input", () => {
    clearTimeout(timer);
    onPick(null); // typing again clears the previous choice
    const text = input.value;
    if (text.trim().length < 2) return close();
    timer = setTimeout(async () => {
      const mine = ++seq;
      draw("Searching…");
      try {
        const res = await search(text);
        if (mine !== seq) return;
        items = res; active = -1;
        res.length ? draw() : draw("No match. Check the spelling or try a shorter name.");
      } catch (e) { if (mine === seq) draw(e.message); }
    }, 300);
  });
  input.addEventListener("keydown", (e) => {
    if (box.hidden || !items.length) return;
    if (e.key === "ArrowDown") { active = Math.min(items.length - 1, active + 1); draw(); e.preventDefault(); }
    else if (e.key === "ArrowUp") { active = Math.max(0, active - 1); draw(); e.preventDefault(); }
    else if (e.key === "Enter" && active >= 0) { pick(active); e.preventDefault(); }
    else if (e.key === "Escape") close();
  });
  input.addEventListener("blur", () => setTimeout(close, 150));
}

const escHTML = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// ---------- Campuses of a school ----------
// The campuses and sites of a school, from OpenStreetMap (through Photon): places tagged as a university
// or college whose name contains the school's name, near the school. E.g. Columbia University →
// Morningside Heights and Manhattanville; Sorbonne Université → Pierre et Marie Curie, Saint-Cyr…
const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const GENERIC = new Set(["university", "universite", "universidad", "universita", "universitat", "universidade", "universiteit", "uniwersytet",
  "college", "school", "ecole", "escuela", "institute", "institut", "instituto", "of", "de", "the", "la", "le", "les", "des", "di", "du", "del", "der", "and", "et", "y", "e", "at", "in"]);
const kmBetween = (a, b) => {
  const r = (x) => (x * Math.PI) / 180, dLa = r(b.lat - a.lat), dLo = r(b.lng - a.lng);
  return 2 * 6371 * Math.asin(Math.sqrt(Math.sin(dLa / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLo / 2) ** 2));
};
export async function campusesOf(school) {
  if (!school?.name) return [];
  const bias = school.lat != null ? `&lat=${school.lat}&lon=${school.lng}` : "";
  const j = await getJSON(`${PHOTON}?q=${enc(school.name)}&limit=30&lang=en${bias}&osm_tag=amenity:university&osm_tag=amenity:college`).catch(() => ({ features: [] }));
  const key = norm(school.name);
  const words = key.split(" ").filter((w) => w.length > 2 && !GENERIC.has(w));
  const city = norm(school.city || school.detail || "");
  let found = (j.features || []).map((f) => {
    const p = f.properties, n = norm(p.name);
    const full = n.includes(key);
    // A partial match must make up most of the other name: "Sorbonne Université - Curie" yes,
    // "City University of New York" no for New York University.
    const theirs = n.split(" ").filter((w) => w.length > 2 && !GENERIC.has(w));
    const loose = words.length > 0 && words.every((w) => theirs.includes(w)) && words.length / Math.max(1, theirs.length) >= 0.6;
    return (full || loose) && {
      name: p.name, full,
      detail: [p.street && [p.housenumber, p.street].filter(Boolean).join(" "), p.district || p.city || p.county, p.country].filter(Boolean).join(", "),
      lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], place: norm([p.city, p.county, p.state].join(" ")),
    };
  }).filter(Boolean);
  // Keep the ones near the school: its known position, or its city, or the best match.
  const anchor = school.lat != null ? { lat: school.lat, lng: school.lng }
    : (city && found.find((c) => c.place.includes(city.split(" ")[0]))) || found.find((c) => c.full) || found[0];
  if (anchor) found = found.filter((c) => kmBetween(anchor, c) < 60);
  // Exact name matches first, then drop near-duplicates (the same site mapped twice).
  found.sort((a, b) => Number(b.full) - Number(a.full));
  const out = [];
  for (const c of found) if (!out.some((o) => kmBetween(o, c) < 0.15)) out.push(c);
  return out.slice(0, 8);
}

// A "Which campus?" list for a chosen school, with "Somewhere else" for any other address.
// onChange gets { name, lat, lng } or null. Returns nothing; draws into `box`.
export async function campusPicker(box, school, current, onChange) {
  if (!school) { box.innerHTML = ""; onChange(null); return; }
  box.innerHTML = `<div class="field"><span>Which campus?</span><div class="campus-list"><span class="suggest-msg">Finding the campuses of ${escHTML(school.name)}…</span></div></div>`;
  const list = await campusesOf(school);
  const options = list.map((c) => ({ name: c.name, detail: c.detail, lat: c.lat, lng: c.lng }));
  if (!options.length && school.lat != null) options.push({ name: school.name, detail: `Main site${school.detail ? ", " + school.detail : ""}`, lat: school.lat, lng: school.lng });
  let pick = current && current.lat != null
    ? options.findIndex((o) => Math.abs(o.lat - current.lat) < 0.0005 && Math.abs(o.lng - current.lng) < 0.0005)
    : 0;
  if (pick < 0) pick = current && current.lat != null ? "other" : 0;
  if (!options.length) pick = "other";
  let other = pick === "other" && current ? current : null;
  const draw = () => {
    box.innerHTML = `<div class="field"><span>Which campus?</span>
      <div class="campus-list" role="radiogroup" aria-label="Campus">
        ${options.map((o, i) => `<label class="campus"><input type="radio" name="campus" value="${i}" ${pick === i ? "checked" : ""}>
          <span><strong>${escHTML(o.name)}</strong>${o.detail ? `<small>${escHTML(o.detail)}</small>` : ""}</span></label>`).join("")}
        <label class="campus"><input type="radio" name="campus" value="other" ${pick === "other" ? "checked" : ""}>
          <span><strong>${options.length ? "Somewhere else" : "Add the address of your campus"}</strong><small>${options.length ? "Type the address where your classes are" : "We couldn't find this school's campuses on the map"}</small></span></label>
      </div>
      ${pick === "other" ? `<input id="campus-addr" value="${escHTML(other?.name || "")}" placeholder="Start typing the street and city">` : ""}
      <small>Each flat shows its travel time to this campus.</small></div>`;
    box.querySelectorAll('input[name="campus"]').forEach((r) => (r.onchange = () => {
      pick = r.value === "other" ? "other" : +r.value;
      draw();
      if (pick === "other") { onChange(other); box.querySelector("#campus-addr")?.focus(); }
    }));
    const addr = box.querySelector("#campus-addr");
    if (addr) autocomplete(addr, searchAddresses, (it) => { other = it; onChange(it); });
    if (pick !== "other") onChange(options[pick]);
  };
  draw();
}
