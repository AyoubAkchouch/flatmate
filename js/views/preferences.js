// Preferences: what a seeker looks for, who a subletter wants to sublet to. Editable any time.
import { sb, state, view, go, esc, q, toast, loadProfile, FEATURES, LIFESTYLE, ICON } from "../lib.js";
import { searchDestinationSchools, autocomplete, campusPicker } from "../schools.js";

export async function renderPreferences() {
  const p = await loadProfile();
  const d = {
    full_name: p.full_name || "", city: p.city || "", phone: p.phone || "",
    exchange_from: p.exchange_from || "", exchange_to: p.exchange_to || "",
    budget_max: p.budget_max || "", kind_pref: p.kind_pref || "any", max_commute: p.max_commute || 45,
    must_haves: [...(p.must_haves || [])], nice_to_haves: [...(p.nice_to_haves || [])], lifestyle: [...(p.lifestyle || [])],
    min_overlap_pct: p.min_overlap_pct ?? 60, require_verified: p.require_verified ?? true, wanted_lifestyle: [...(p.wanted_lifestyle || [])],
    host: p.host_university ? { name: p.host_university, lat: p.host_lat, lng: p.host_lng } : null,
    campus: p.host_lat != null ? { name: p.host_campus || p.host_university, lat: p.host_lat, lng: p.host_lng } : null,
  };
  // Seekers in "subletting my flat" view edit their ideal tenant instead of their flat search.
  const provider = p.role === "subletter" || (p.role === "seeker" && p.view_mode === "provider");
  const seeker = p.role === "seeker" && !provider, subletter = provider, student = p.role !== "landlord";

  const chips = (key, list, other = null) => `<div class="checkchips" data-chips="${key}">${list.map((t) =>
    `<label><input type="checkbox" value="${esc(t)}" ${d[key].includes(t) ? "checked" : ""} ${other && d[other].includes(t) ? "disabled" : ""}>${esc(t)}</label>`).join("")}</div>`;
  const seg = (key, options) => `<div class="seg" data-seg="${key}">${options.map(([v, t]) =>
    `<button type="button" data-v="${v}" aria-pressed="${String(d[key]) === String(v)}">${t}</button>`).join("")}</div>`;

  view().innerHTML = `<div class="ob">
    <a class="back" href="#/profile">‹ Profile</a>
    <h2>${seeker ? "What you're looking for" : subletter ? "Who you'd like to sublet to" : "Your details"}</h2>
    <p class="lead">${seeker ? "Your deck is ranked with these. Change them any time." : subletter ? "Students who said yes to your flat are ranked with these." : "Shown to the students you approve sublets for."}</p>
    <form class="form" id="pf" novalidate>
      <section class="pref-sec"><h3>About you</h3>
        <label class="field"><span>Full name</span><input id="p-name" value="${esc(d.full_name)}"></label>
        ${student ? `<div class="two"><label class="field"><span>${p.role === "seeker" ? "Arriving" : "Leaving"}</span><input id="p-from" type="date" value="${esc(d.exchange_from)}"></label>
          <label class="field"><span>${p.role === "seeker" ? "Leaving" : "Back"}</span><input id="p-to" type="date" value="${esc(d.exchange_to)}"></label></div>`
          : `<label class="field"><span>Phone</span><input id="p-phone" value="${esc(d.phone)}"></label>`}
        <label class="field"><span>City</span><input id="p-city" value="${esc(d.city)}"></label>
      </section>

      ${seeker ? `
      <section class="pref-sec"><h3>School and campus</h3>
        <div class="field"><span>School you're going to</span><input id="p-host" value="${esc(d.host?.name || "")}" placeholder="Start typing"></div>
        <div id="p-campus-box"></div>
      </section>
      <section class="pref-sec"><h3>The flat</h3>
        <label class="field"><span>Maximum rent per month</span><input id="p-budget" type="number" min="100" step="10" inputmode="numeric" value="${esc(d.budget_max)}" placeholder="e.g. 800"></label>
        <div class="field"><span>Type</span>${seg("kind_pref", [["any", "Either"], ["whole", "Whole flat"], ["room", "Room in a flatshare"]])}</div>
        <div class="field"><span>Longest commute to campus</span>${seg("max_commute", [[20, "20 min"], [30, "30 min"], [45, "45 min"], [60, "1 hour"]])}</div>
        <div class="field"><span>Must have</span>${chips("must_haves", FEATURES, "nice_to_haves")}<small>Flats without these drop down your deck.</small></div>
        <div class="field"><span>Nice to have</span>${chips("nice_to_haves", FEATURES, "must_haves")}<small>Flats with these rank higher.</small></div>
      </section>` : ""}

      ${student ? `<section class="pref-sec"><h3>You as a flatmate</h3>
        <div class="field">${chips("lifestyle", LIFESTYLE)}<small>Shown to subletters and used to rank you for their flats.</small></div></section>` : ""}

      ${subletter ? `
      <section class="pref-sec"><h3>Your ideal tenant</h3>
        <div class="field"><span>They should stay for at least</span>${seg("min_overlap_pct", [[30, "30%"], [50, "50%"], [70, "70%"], [90, "90%"]])}<small>Share of the time your flat is free.</small></div>
        <div class="field"><span>Verified identity</span>${seg("require_verified", [["true", "Required"], ["false", "Preferred"]])}</div>
        <div class="field"><span>Ideally they are</span>${chips("wanted_lifestyle", LIFESTYLE)}</div>
        <a class="btn" href="#/profile">Edit your flats from your profile</a>
      </section>` : ""}

      <p class="err" id="perr" hidden></p>
      <button class="btn primary full" id="psave">Save</button>
    </form></div>`;

  // Segmented buttons and chips write into the draft.
  view().querySelectorAll("[data-seg]").forEach((g) => g.querySelectorAll("button").forEach((b) => (b.onclick = () => {
    const key = g.dataset.seg;
    d[key] = key === "require_verified" ? b.dataset.v === "true" : isNaN(+b.dataset.v) ? b.dataset.v : +b.dataset.v;
    g.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b));
  })));
  view().querySelectorAll("[data-chips]").forEach((g) => g.addEventListener("change", () => {
    const key = g.dataset.chips;
    d[key] = [...g.querySelectorAll("input:checked")].map((i) => i.value);
    // A feature can be a must-have or a nice-to-have, not both.
    const other = { must_haves: "nice_to_haves", nice_to_haves: "must_haves" }[key];
    if (other) view().querySelectorAll(`[data-chips="${other}"] input`).forEach((i) => { i.disabled = d[key].includes(i.value); });
  }));
  if (seeker) {
    const campusBox = document.getElementById("p-campus-box");
    const drawCampus = () => campusPicker(campusBox, d.host, d.campus, (place) => { d.campus = place; });
    autocomplete(document.getElementById("p-host"), searchDestinationSchools, (it) => { d.host = it; d.campus = null; drawCampus(); });
    drawCampus();
  }

  document.getElementById("pf").onsubmit = async (e) => {
    e.preventDefault();
    const v = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ""; };
    const err = (m) => { const el = document.getElementById("perr"); el.textContent = m; el.hidden = false; el.scrollIntoView({ block: "center" }); };
    const patch = { full_name: v("p-name"), city: v("p-city") };
    if (!patch.full_name || !patch.city) return err("Your name and city can't be empty.");
    if (student) {
      patch.exchange_from = v("p-from") || null; patch.exchange_to = v("p-to") || null;
      if (!patch.exchange_from || !patch.exchange_to || patch.exchange_to <= patch.exchange_from) return err("Check your dates: the end needs to be after the start.");
      patch.lifestyle = d.lifestyle;
    } else patch.phone = v("p-phone");
    if (seeker) {
      if (!d.host) return err("Choose the school you're going to from the suggestions.");
      const place = d.campus;
      if (!place) return err("Choose your campus, or type its address and pick it from the suggestions.");
      const budget = v("p-budget");
      Object.assign(patch, {
        host_university: d.host.name, host_campus: place.name, host_lat: place.lat, host_lng: place.lng,
        budget_max: budget ? Math.round(+budget) : null, kind_pref: d.kind_pref, max_commute: d.max_commute,
        must_haves: d.must_haves, nice_to_haves: d.nice_to_haves,
      });
    }
    if (subletter) Object.assign(patch, { min_overlap_pct: d.min_overlap_pct, require_verified: d.require_verified, wanted_lifestyle: d.wanted_lifestyle });
    const btn = document.getElementById("psave"); btn.disabled = true; btn.textContent = "Saving…";
    try {
      await q(sb.from("profiles").update(patch).eq("id", p.id));
      await loadProfile();
      toast(seeker ? "Saved. Your deck is re-ranked." : "Saved.");
      go(seeker ? "discover" : "profile");
    } catch { btn.disabled = false; btn.textContent = "Save"; }
  };
}
