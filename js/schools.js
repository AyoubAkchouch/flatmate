// Official school data, fetched live.
//  • French institutions recognised by the higher-education ministry (data.enseignementsup-recherche.gouv.fr),
//    with the GPS position of their main site. Updated by the ministry; no key needed.
//  • Universities worldwide from the Research Organization Registry (ror.org), for home universities
//    and for French schools the ministry list doesn't include (many private schools).
//  • Addresses in France from the national geocoder (IGN Géoplateforme), to pin an exact campus.

const MINISTRY = "https://data.enseignementsup-recherche.gouv.fr/api/explore/v2.1/catalog/datasets/fr-esr-principaux-etablissements-enseignement-superieur/records";
const ROR = "https://api.ror.org/v2/organizations";
const GEO = "https://data.geopf.fr/geocodage/search";
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

// Destination school in France: the ministry list first, then the worldwide registry for the rest.
export async function searchFrenchSchools(text) {
  const t = quote(text);
  if (t.length < 2) return [];
  const where = `search(uo_lib, "${t}") or search(sigle, "${t}") or search(nom_court, "${t}")`;
  const [ministry, ror] = await Promise.all([
    getJSON(`${MINISTRY}?limit=8&select=uo_lib,sigle,com_nom,coordonnees,identifiant_ror&where=${enc(where)}`).catch(() => ({ results: [] })),
    getJSON(`${ROR}?query=${enc(t)}&filter=types:education,locations.geonames_details.country_code:FR`).catch(() => ({ items: [] })),
  ]);
  const out = (ministry.results || []).map((r) => ({
    name: r.uo_lib, detail: r.com_nom || "", source: "ministry",
    lat: r.coordonnees?.lat ?? null, lng: r.coordonnees?.lon ?? null,
    ror: (r.identifiant_ror || [])[0] || null,
  }));
  const known = new Set(out.map((o) => o.ror).filter(Boolean));
  for (const i of (ror.items || []).slice(0, 6)) {
    const id = i.id.replace("https://ror.org/", "");
    if (known.has(id)) continue;
    const g = i.locations?.[0]?.geonames_details || {};
    // The registry only knows the city, so these schools need a campus address for travel times.
    out.push({ name: rorName(i), detail: g.name || "", source: "registry", lat: null, lng: null, ror: id });
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

// Address search in France, for pinning a campus or a flat.
export async function searchAddresses(text) {
  if (text.trim().length < 3) return [];
  const j = await getJSON(`${GEO}?q=${enc(text)}&autocomplete=1&limit=6`);
  return (j.features || []).map((f) => ({ name: f.properties.label, detail: f.properties.context || "", lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] }));
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
