// Profile: your details, your flats with the demand calculator, your starred flats.
import { sb, state, view, go, esc, q, toast, ICON, avatar, travelTo, demandFor, priceSuggestion, fmtDate, fmtShort, loadProfile, photoUrl } from "../lib.js";
import { ROLE_LABEL } from "./onboarding.js";

const STATUS = {
  verified: (t) => `<span class="pill ok">${t} verified</span>`,
  pending: (t) => `<span class="pill wait">${t} pending</span>`,
  failed: (t) => `<span class="pill red">${t} not accepted</span>`,
  none: (t) => `<span class="pill red">${t} missing</span>`,
  not_needed: () => "",
};

export async function renderProfile() {
  view().innerHTML = `<p class="loading">Loading…</p>`;
  const p = await loadProfile();
  const isLandlord = p.role === "landlord";

  const [mine, starRows, statsRows, cityListings] = await Promise.all([
    isLandlord ? [] : q(sb.from("listings").select("*").eq("owner_id", p.id).order("created_at")),
    p.role === "seeker" ? q(sb.from("stars").select("listing_id, listing:listings(*)").eq("user_id", p.id).order("created_at", { ascending: false })) : [],
    q(sb.rpc("listing_stats")),
    q(sb.from("listings").select("id, city, rent, size_m2").eq("active", true)),
  ]);
  const stats = Object.fromEntries(statsRows.map((r) => [r.listing_id, r]));

  const listingCard = (l) => {
    const d = demandFor(l, stats, cityListings.concat(l.active ? [] : [l]));
    const s = priceSuggestion(l, d);
    const label = { high: "High demand", low: "Low demand", normal: "Normal demand" }[d.level];
    const pos = Math.min(98, Math.max(2, (d.ratio / 2) * 100));
    return `<article class="listing">
      <div class="row"><strong>${esc(l.title)}</strong><span class="price">€${l.rent}<small> / month</small></span></div>
      <div class="stats"><span>${esc(l.area ? l.area + ", " : "")}${esc(l.city)}</span><span>${l.size_m2} m²</span><span>${fmtShort(l.available_from)} → ${fmtDate(l.available_to)}</span>
        ${l.active ? "" : `<span class="pill red">Paused</span>`}</div>
      ${l.active ? `
      <div class="stats"><span><b>${d.views}</b> views</span><span><b>${d.interested}</b> interested this week</span><span>Similar flats <b>€${d.similarRent}</b></span></div>
      <div><div class="gauge" role="img" aria-label="${label}"><i style="left:${pos}%"></i></div><div class="gauge-l"><span>LOW</span><span>NORMAL</span><span>HIGH</span></div></div>
      <div class="suggest"><span><b>${label}.</b> ${s.text}</span>
        ${s.price ? `<button class="btn primary" data-apply="${l.id}" data-p="${s.price}">Change price to €${s.price}</button>` : ""}</div>
      <small style="font-size:12px;color:var(--muted)">${d.basis === "interest"
        ? `Based on views, yeses and stars this week, compared with ${d.peers} flats in ${esc(l.city)}.`
        : `Not enough activity yet in ${esc(l.city)}, so this compares your price per m² with ${d.peers > 1 ? `${d.peers} flats` : "similar flats"} there.`}</small>` : ""}
      <a class="btn" href="#/list/${l.id}">Edit or pause</a></article>`;
  };

  const starred = starRows.filter((r) => r.listing);
  const starRow = (r) => {
    const l = r.listing, d = demandFor(l, stats, cityListings), tr = travelTo(l, p.host_university);
    return `<div class="srow">${l.photos?.[0] ? `<img src="${esc(photoUrl(l.photos[0]))}" alt="" style="width:44px;height:44px;border-radius:8px;object-fit:cover">` : ""}
      <span class="t"><strong>${esc(l.title)}</strong><span>€${l.rent}${tr ? ` · ${tr.minutes} min to ${esc(tr.uni)}` : ""}${l.active ? "" : " · no longer listed"}</span></span>
      ${d.level === "high" ? `<span class="pill red">High demand</span>` : d.level === "low" ? `<span class="pill gem">Hidden gem</span>` : ""}
      <button class="star on" data-unstar="${l.id}" aria-label="Remove star">${ICON.star}</button></div>`;
  };

  view().innerHTML = `<div>
    <div class="idcard">${avatar(p.full_name, p.id)}
      <span><b>${esc(p.full_name)}</b><br><span style="color:var(--muted);font-size:13px">${ROLE_LABEL[p.role] || ""}</span>
      <span class="checks">${STATUS[p.id_status]("ID")}${STATUS[p.student_status]("Student")}</span></span></div>
    <dl class="pdl">
      <dt>Email</dt><dd>${esc(p.email)}</dd>
      ${p.home_university ? `<dt>Home university</dt><dd>${esc(p.home_university)}</dd>` : ""}
      ${p.host_university ? `<dt>Going to</dt><dd>${esc(p.host_university)}</dd>` : ""}
      <dt>City</dt><dd>${esc(p.city)}</dd>
      ${p.exchange_from ? `<dt>Exchange</dt><dd>${fmtDate(p.exchange_from)} → ${fmtDate(p.exchange_to)}</dd>` : ""}
    </dl>
    ${["failed", "none"].includes(p.id_status) || ["failed", "none"].includes(p.student_status) ? `<div class="banner" style="margin-top:14px">A check is missing or wasn't accepted. <button class="linkbtn" id="redo" style="padding:0">Do it again</button></div>` : ""}
    ${isLandlord ? `<section class="psec"><h3>My sublet requests</h3><p class="lead">They appear on your home screen when a tenant invites you from a chat.</p></section>`
      : `<section class="psec"><div class="psec-h"><h3>My flats to sublet</h3><a class="btn" href="#/list">+ Add a flat</a></div>
        ${mine.length ? mine.map(listingCard).join("") : `<p class="lead">Leaving your own flat empty during your exchange? List it and see how much demand there is.</p>`}</section>`}
    ${p.role === "seeker" ? `<section class="psec"><h3>Starred flats</h3>${starred.length ? starred.map(starRow).join("") : `<p class="lead">Tap the star on a flat while swiping to keep it here.</p>`}</section>` : ""}
    <section class="psec">
      ${p.is_admin ? `<a class="btn" href="#/admin">Review verification checks</a>` : ""}
      <button class="btn" id="logout">Log out</button></section>
  </div>`;

  view().querySelectorAll("[data-apply]").forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    try {
      await q(sb.from("listings").update({ rent: +b.dataset.p }).eq("id", b.dataset.apply));
      toast(`Price updated to €${b.dataset.p}.`);
      renderProfile();
    } catch { b.disabled = false; }
  }));
  view().querySelectorAll("[data-unstar]").forEach((b) => (b.onclick = async () => {
    await q(sb.from("stars").delete().eq("user_id", p.id).eq("listing_id", b.dataset.unstar));
    renderProfile();
  }));
  const redo = document.getElementById("redo");
  if (redo) redo.onclick = async () => {
    await q(sb.from("profiles").update({ onboarded: false }).eq("id", p.id));
    await loadProfile();
    go("onboarding");
  };
  document.getElementById("logout").onclick = async () => { await sb.auth.signOut(); go("welcome"); };
}
