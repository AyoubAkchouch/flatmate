// Profile: your details, your flats with the demand calculator, your starred flats.
import { sb, state, view, go, esc, q, toast, ICON, avatar, travelTo, hostPlace, travelMinutes, distanceKm, demandFor, demandData, priceSuggestion, starsHTML, fmtDate, fmtShort, loadProfile, photoUrl, money, storageSafeName, layout } from "../lib.js";
import { ROLE_LABEL } from "./onboarding.js";
import { schoolsNear } from "../schools.js";
import { needsChecks, startChecks } from "./discover.js";

const STATUS = {
  verified: (t) => `<span class="pill ok">${t} verified</span>`,
  pending: (t) => `<span class="pill wait">${t} pending</span>`,
  failed: (t) => `<span class="pill red">${t} not accepted</span>`,
  none: (t) => `<span class="pill wait">${t} not checked yet</span>`,
  not_needed: () => "",
};

export async function renderProfile() {
  view().innerHTML = `<p class="loading">Loading…</p>`;
  const p = await loadProfile();
  const isLandlord = p.role === "landlord";

  const [mine, starRows, aboutMe] = await Promise.all([
    isLandlord ? [] : q(sb.from("listings").select("*").eq("owner_id", p.id).order("created_at")),
    p.role === "seeker" ? q(sb.from("stars").select("listing_id, listing:listings(*)").eq("user_id", p.id).order("created_at", { ascending: false })) : [],
    q(sb.from("reviews").select("rating, comment, kind, created_at, listing_id, author:profiles!reviews_author_id_fkey(full_name)").eq("subject_id", p.id).order("created_at", { ascending: false }).limit(50)),
  ]);
  // Seekers who also list a flat can switch between the two sides.
  const dual = p.role === "seeker" && mine.length > 0;
  const mode = p.role === "subletter" ? "provider" : p.role === "seeker" ? (dual && p.view_mode === "provider" ? "provider" : "seeker") : "landlord";
  const ids = mine.map((l) => l.id).concat(starRows.map((r) => r.listing_id));
  const [dd, flatReviews] = await Promise.all([
    demandData(ids),
    ids.length ? q(sb.from("reviews").select("listing_id, rating").eq("kind", "flat").in("listing_id", ids)) : [],
  ]);
  const flatRating = (id) => { const r = flatReviews.filter((x) => x.listing_id === id); return r.length ? [r.reduce((a, x) => a + x.rating, 0) / r.length, r.length] : [0, 0]; };

  const listingCard = (l) => {
    const d = demandFor(l, dd.stat[l.id], dd.benchFor(l));
    const s = priceSuggestion(l, d);
    const label = { high: "High demand", low: "Low demand", normal: "Normal demand" }[d.level];
    const pos = Math.min(98, Math.max(2, (d.ratio / 2) * 100));
    return `<article class="listing">
      <div class="row"><strong>${esc(l.title)}</strong><span class="price">${money(l.rent, l.currency)}<small> / month</small></span></div>
      ${starsHTML(...flatRating(l.id))}
      <div class="stats"><span>${esc(l.area ? l.area + ", " : "")}${esc(l.city)}</span><span>${l.size_m2} m²</span><span>${fmtShort(l.available_from)} → ${fmtDate(l.available_to)}</span>
        ${l.active ? "" : `<span class="pill red">Paused</span>`}</div>
      ${l.active ? `
      <div class="stats"><span><b>${d.views}</b> views</span><span><b>${d.interested}</b> interested this week</span><span>Similar flats <b>${money(d.similarRent, l.currency)}</b></span></div>
      <div><div class="gauge" role="img" aria-label="${label}"><i style="left:${pos}%"></i></div><div class="gauge-l"><span>LOW</span><span>NORMAL</span><span>HIGH</span></div></div>
      <div class="suggest"><span><b>${label}.</b> ${s.text}</span>
        ${s.price ? `<button class="btn primary" data-apply="${l.id}" data-p="${s.price}" data-cur="${esc(l.currency)}">Change price to ${money(s.price, l.currency)}</button>` : ""}</div>
      <small style="font-size:12px;color:var(--muted)">${d.basis === "interest"
        ? `Based on views, yeses and stars this week, compared with ${d.peers} flats in ${esc(l.city)}.`
        : `Not enough activity yet in ${esc(l.city)}, so this compares your price per m² with ${d.peers > 1 ? `${d.peers} flats` : "similar flats"} there.`}</small>` : ""}
      ${l.lat != null ? `<div class="near-list" data-near="${l.id}" data-lat="${l.lat}" data-lng="${l.lng}"><span>Finding schools nearby…</span></div>`
        : `<small style="font-size:12px;color:var(--muted)">Add a full street address to show travel times to nearby schools.</small>`}
      <a class="btn" href="#/list/${l.id}">Edit or pause</a></article>`;
  };

  const starred = starRows.filter((r) => r.listing);
  const starRow = (r) => {
    const l = r.listing, d = demandFor(l, dd.stat[l.id], dd.benchFor(l)), tr = travelTo(l, hostPlace(p));
    return `<div class="srow">${l.photos?.[0] ? `<img src="${esc(photoUrl(l.photos[0]))}" alt="" style="width:44px;height:44px;border-radius:8px;object-fit:cover">` : ""}
      <span class="t"><strong>${esc(l.title)}</strong>${starsHTML(...flatRating(l.id))}<span style="display:block">${money(l.rent, l.currency)}${tr ? ` · ${tr.minutes} min to ${esc(tr.uni)}` : ""}${l.active ? "" : " · no longer listed"}</span></span>
      ${d.level === "high" ? `<span class="pill red">High demand</span>` : d.level === "low" ? `<span class="pill gem">Hidden gem</span>` : ""}
      <button class="star on" data-unstar="${l.id}" aria-label="Remove star">${ICON.star}</button></div>`;
  };

  view().innerHTML = `<div>
    <div class="idcard"><div class="avatar-edit">
        <label class="avatar-btn" for="avatar-file" title="${p.avatar_url ? "Change your photo" : "Add a profile photo"}">${avatar(p.full_name, p.id, "", p.avatar_url)}
          <span class="avatar-badge" aria-hidden="true">${ICON.photo}</span></label>
        <input type="file" id="avatar-file" accept="image/*" hidden>
        <span class="avatar-actions"><label class="linkbtn" for="avatar-file">${p.avatar_url ? "Change photo" : "Add photo"}</label>
          ${p.avatar_url ? `<button type="button" class="linkbtn" id="avatar-rm">Remove</button>` : ""}</span></div>
      <span><b>${esc(p.full_name)}</b><br><span style="color:var(--muted);font-size:13px">${dual ? "Looking for a flat · subletting their own" : ROLE_LABEL[p.role] || ""}</span>
      <span class="checks">${STATUS[p.id_status]("ID")}${STATUS[p.student_status]("Student")}</span></span></div>
    <dl class="pdl">
      <dt>Email</dt><dd>${esc(p.email)}</dd>
      ${p.home_university ? `<dt>Home university</dt><dd>${esc(p.home_university)}</dd>` : ""}
      ${p.host_university ? `<dt>Going to</dt><dd>${esc(p.host_university)}${p.host_campus ? `<br><span style="font-weight:400;color:var(--muted)">${esc(p.host_campus)}</span>` : ""}</dd>` : ""}
      <dt>City</dt><dd>${esc(p.city)}</dd>
      ${p.exchange_from ? `<dt>Exchange</dt><dd>${fmtDate(p.exchange_from)} → ${fmtDate(p.exchange_to)}</dd>` : ""}
    </dl>
    ${dual ? `<div class="pref-sec" style="margin-top:14px"><h3>You're using the app as</h3>
      <div class="seg" role="group" aria-label="Switch view">
        <button type="button" data-view="seeker" aria-pressed="${mode === "seeker"}">Looking for a flat</button>
        <button type="button" data-view="provider" aria-pressed="${mode === "provider"}">Subletting my flat</button></div>
      <small style="color:var(--muted);font-size:12px">${mode === "seeker" ? "Discover shows flats ranked for you." : "Discover shows the students who want your flat."}</small></div>` : ""}
    ${p.role !== "landlord" ? `<a class="btn full" href="#/preferences" style="margin-top:14px">${mode === "seeker" ? "Edit what you're looking for" : "Edit your ideal tenant and details"}</a>`
      : `<a class="btn full" href="#/preferences" style="margin-top:14px">Edit your details</a>`}
    ${p.role === "seeker" && needsChecks(p) ? `<div class="banner" style="margin-top:14px">Verify your identity and student status before you say yes to a flat. <button class="linkbtn" id="verify" style="padding:0">Verify now</button></div>`
      : ["failed", "none"].includes(p.id_status) || ["failed", "none"].includes(p.student_status) ? `<div class="banner" style="margin-top:14px">A check is missing or wasn't accepted. <button class="linkbtn" id="redo" style="padding:0">Do it again</button></div>` : ""}
    ${isLandlord ? `<section class="psec"><h3>My sublet requests</h3><p class="lead">They appear on your home screen when a tenant invites you from a chat.</p></section>`
      : dual && mode === "seeker" ? ""
      : `<section class="psec"><div class="psec-h"><h3>My flats to sublet</h3><a class="btn" href="#/list">+ Add a flat</a></div>
        ${mine.length ? mine.map(listingCard).join("") : `<p class="lead">Leaving your own flat empty during your exchange? List it and see how much demand there is.</p>`}</section>`}
    ${mode === "seeker" ? `<section class="psec"><h3>Starred flats</h3>${starred.length ? starred.map(starRow).join("") : `<p class="lead">Tap the star on a flat while swiping to keep it here.</p>`}</section>` : ""}
    ${reviewsSection(p, aboutMe, mode)}
    <section class="psec"><h3>Display</h3>
      <div class="seg" role="group" aria-label="Layout">${[["auto", "Automatic"], ["mobile", "Phone"], ["desktop", "Desktop"]].map(([k, t]) =>
        `<button type="button" data-layout="${k}" aria-pressed="${layout.get() === k}">${t}</button>`).join("")}</div>
      <small style="color:var(--muted);font-size:12px">Automatic uses the desktop layout on wide screens and the phone layout everywhere else.</small></section>
    <section class="psec">
      ${p.is_admin ? `<a class="btn" href="#/admin">Review verification checks</a>` : ""}
      <button class="btn" id="logout">Log out</button></section>
  </div>`;

  view().querySelectorAll("[data-apply]").forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try {
      await q(sb.from("listings").update({ rent: +b.dataset.p }).eq("id", b.dataset.apply));
      toast(`Price updated to ${money(b.dataset.p, b.dataset.cur)}.`);
      renderProfile();
    } catch { b.disabled = false; }
  }));
  view().querySelectorAll("[data-unstar]").forEach((b) => (b.onclick = async () => {
    await q(sb.from("stars").delete().eq("user_id", p.id).eq("listing_id", b.dataset.unstar));
    renderProfile();
  }));
  // Recognised schools close to each of your flats, with an estimated travel time.
  view().querySelectorAll("[data-near]").forEach(async (el) => {
    const here = { lat: +el.dataset.lat, lng: +el.dataset.lng };
    try {
      const list = await schoolsNear(here.lat, here.lng, 4, 4);
      el.innerHTML = list.length
        ? `<span>Close to recognised schools:</span>${list.map((s) => `<span><b>${travelMinutes(distanceKm(here, s))} min</b> · ${esc(s.name)}</span>`).join("")}<span>Seekers also see the time to their own campus.</span>`
        : `<span>No recognised school within 4 km. Seekers still see the time to their own campus.</span>`;
    } catch { el.innerHTML = `<span>Nearby schools can't be loaded right now.</span>`; }
  });
  const vf = document.getElementById("verify");
  if (vf) vf.onclick = startChecks;
  const redo = document.getElementById("redo");
  if (redo) redo.onclick = async () => {
    await q(sb.from("profiles").update({ onboarded: false }).eq("id", p.id));
    await loadProfile();
    go("onboarding");
  };
  view().querySelectorAll("[data-view]").forEach((b) => (b.onclick = async () => {
    if (b.dataset.view === mode) return;
    await q(sb.from("profiles").update({ view_mode: b.dataset.view }).eq("id", p.id));
    toast(b.dataset.view === "provider" ? "Switched to subletting your flat." : "Switched to looking for a flat.");
    renderProfile();
  }));
  // Profile photo: shrunk in the browser to a small square before upload, so it loads fast everywhere.
  document.getElementById("avatar-file").onchange = async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    if (!/^image\//.test(f.type)) return toast("Choose a photo (JPG, PNG or HEIC).", "err");
    try {
      toast("Uploading your photo…");
      const blob = await squareImage(f, 480);
      const path = `${p.id}/avatar-${storageSafeName({ name: "a.jpg" })}`;
      await q(sb.storage.from("listing-photos").upload(path, blob, { contentType: "image/jpeg" }));
      await q(sb.from("profiles").update({ avatar_url: path }).eq("id", p.id));
      toast("Photo updated. Other students see it on your cards and in chats.");
      renderProfile();
    } catch { /* shown */ }
  };
  const rm = document.getElementById("avatar-rm");
  if (rm) rm.onclick = async () => {
    await q(sb.from("profiles").update({ avatar_url: null }).eq("id", p.id));
    toast("Photo removed.");
    renderProfile();
  };
  view().querySelectorAll("[data-layout]").forEach((b) => (b.onclick = () => {
    layout.set(b.dataset.layout);
    view().querySelectorAll("[data-layout]").forEach((x) => x.setAttribute("aria-pressed", x === b));
  }));
  document.getElementById("logout").onclick = async () => { await sb.auth.signOut(); go("welcome"); };
}

// What others said: about you as a tenant, or about your flats.
function reviewsSection(p, all, mode) {
  if (mode === "landlord") return "";
  const rows = all.filter((r) => r.kind === (mode === "seeker" ? "tenant" : "flat"));
  const title = mode === "seeker" ? "Reviews from your hosts" : "Reviews of your flats";
  if (!rows.length) return `<section class="psec"><h3>${title}</h3><p class="lead">${mode === "seeker"
    ? "After a sublet, the student you stayed with can rate you as a tenant. Good reviews move you up their list."
    : "After a sublet, your tenant can rate your flat. Good reviews move it up in students' decks."}</p></section>`;
  const avg = rows.reduce((a, r) => a + r.rating, 0) / rows.length;
  return `<section class="psec"><div class="psec-h"><h3>${title}</h3>${starsHTML(avg, rows.length)}</div>
    ${rows.slice(0, 6).map((r) => `<div class="review"><div class="row">${starsHTML(r.rating, 1).replace(/ <small>.*<\/small>/, "")}<small>${fmtDate(r.created_at)}</small></div>
      ${r.comment ? `<p>${esc(r.comment)}</p>` : ""}<small>${esc(r.author?.full_name || "A student")}</small></div>`).join("")}</section>`;
}

// Crop the middle of a photo to a square and shrink it, as a JPEG.
function squareImage(file, size) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const side = Math.min(img.naturalWidth, img.naturalHeight);
      const c = document.createElement("canvas");
      c.width = c.height = Math.min(size, side);
      c.getContext("2d").drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      c.toBlob((b) => (b ? resolve(b) : reject(new Error("This photo can't be read. Try a JPG or PNG."))), "image/jpeg", 0.86);
    };
    img.onerror = () => { toast("This photo can't be read. Try a JPG or PNG.", "err"); reject(new Error("unreadable")); };
    img.src = URL.createObjectURL(file);
  });
}
