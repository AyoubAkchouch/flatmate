// Discover: seekers swipe flats, subletters swipe the students who liked their flat, landlords see their requests.
import { sb, state, view, go, esc, q, toast, ICON, avatar, photoUrl, floorPlan, demandFor, starsHTML, fmtShort, fmtDate, money, loadProfile, isDesktop } from "../lib.js";

const loading = `<p class="loading">Loading…</p>`;

export async function renderDiscover() {
  view().innerHTML = loading;
  const role = state.profile.role;
  if (role === "seeker") return state.profile.view_mode === "provider" ? ownerDeck() : seekerDeck();
  if (role === "subletter") return ownerDeck();
  return landlordHome();
}

// ---------- Swipe mechanics shared by both decks ----------
function mountDeck({ items, card, onSwipe, onTop, empty, refill, onOpen, beforeLike }) {
  const deckEl = document.getElementById("deck");
  let loading = false;
  const topUp = async () => {
    // Fetch the next batch before the deck runs out.
    if (!refill || loading || items.length > 4) return;
    loading = true;
    try {
      const more = await refill();
      const known = new Set(items.map((i) => i.id));
      const wasEmpty = !items.length;
      more.filter((m) => !known.has(m.id)).forEach((m) => items.push(m));
      if (!more.length) refill = null;
      if (wasEmpty && items.length) draw();
    } finally { loading = false; }
  };
  const draw = () => {
    if (!items.length) {
      if (refill) { deckEl.innerHTML = `<p class="loading">Finding more flats…</p>`; topUp().then(() => { if (!items.length) draw(); }); return; }
      (deckEl.closest(".discover-grid") || deckEl.parentElement).innerHTML = empty(); return;
    }
    topUp();
    deckEl.innerHTML = "";
    items.slice(0, 2).reverse().forEach((item, i, arr) => {
      const top = i === arr.length - 1;
      const el = document.createElement("article");
      el.className = "card";
      if (!top) el.style.transform = "scale(.96) translateY(10px)";
      el.innerHTML = card(item);
      deckEl.appendChild(el);
      if (top) { drag(el); onTop && onTop(item, el); }
    });
  };
  const decide = (dir) => {
    const el = deckEl.querySelector(".card:last-child");
    if (!el || !items.length) return;
    if (dir > 0 && beforeLike && !beforeLike(items[0])) {
      // Not allowed to say yes yet: put the card back.
      el.style.transform = "";
      el.querySelectorAll(".stamp").forEach((x) => (x.style.opacity = 0));
      return;
    }
    el.style.transform = `translateX(${dir * 600}px) rotate(${dir * 25}deg)`;
    const item = items.shift();
    setTimeout(draw, 220);
    onSwipe(item, dir > 0);
  };
  function drag(el) {
    let x0 = null, dx = 0;
    const like = el.querySelector(".stamp.like"), nope = el.querySelector(".stamp.nope");
    let y0 = 0, dy = 0;
    el.addEventListener("pointerdown", (e) => { if (e.target.closest("button,a")) return; x0 = e.clientX; y0 = e.clientY; dx = 0; dy = 0; el.setPointerCapture(e.pointerId); el.classList.add("dragging"); });
    el.addEventListener("pointermove", (e) => {
      if (x0 === null) return;
      dx = e.clientX - x0; dy = e.clientY - y0;
      el.style.transform = `translateX(${dx}px) rotate(${dx / 18}deg)`;
      if (like) like.style.opacity = Math.max(0, dx / 100);
      if (nope) nope.style.opacity = Math.max(0, -dx / 100);
    });
    const end = () => {
      if (x0 === null) return;
      x0 = null; el.classList.remove("dragging");
      // A tap (no real movement) opens the details.
      if (onOpen && Math.abs(dx) < 6 && Math.abs(dy) < 6) { el.style.transform = ""; onOpen(items[0], decide); return; }
      if (Math.abs(dx) > 100) decide(Math.sign(dx));
      else { el.style.transform = ""; if (like) like.style.opacity = 0; if (nope) nope.style.opacity = 0; }
    };
    el.addEventListener("pointerup", end);
    el.addEventListener("pointercancel", end);
  }
  document.getElementById("pass").onclick = () => decide(-1);
  document.getElementById("like").onclick = () => decide(1);
  draw();
}

const deckShell = (filters, hint) => `
  <div class="filters">${filters}</div>
  <div class="discover-grid"><div class="deck-col"><div class="deck" id="deck"></div>
  <div class="actions"><button class="round pass" id="pass" aria-label="Pass">${ICON.x}</button><button class="round like" id="like" aria-label="Yes">${ICON.yes}</button></div>
  <p class="hint">${hint}</p></div>
  <aside class="deck-side" id="deckSide" aria-live="polite"></aside></div>
  <a class="fab" href="#/list" aria-label="List your own flat to sublet">${ICON.plus}</a>`;

function showMatch(matchId, title, text) {
  const o = document.createElement("div");
  o.className = "overlay";
  const today = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).toUpperCase().replace(/ /g, " · ");
  o.innerHTML = `<div class="match"><div class="passport"><div><span>${esc((state.profile.city || "").toUpperCase())}</span><strong>MATCHED</strong><span>${today}</span></div></div>
    <h3 class="section-title" style="margin:0">${esc(title)}</h3><p>${esc(text)}</p>
    <div class="btns"><button class="btn primary" id="mgo">Open chat</button><button class="btn" id="mstay">Keep swiping</button></div></div>`;
  document.body.appendChild(o);
  o.querySelector("#mgo").onclick = () => { o.remove(); go("chat/" + matchId); };
  o.querySelector("#mstay").onclick = () => o.remove();
  o.querySelector("#mgo").focus();
}

async function findMatch(listingId, seekerId) {
  const { data } = await sb.from("matches").select("id").eq("listing_id", listingId).eq("seeker_id", seekerId).maybeSingle();
  return data;
}

// ---------- Checks before saying yes ----------
// Seekers can browse freely; the identity and student checks are needed before the first yes.
export const needsChecks = (p) => p.role === "seeker"
  && (!["verified", "pending"].includes(p.id_status) || !["verified", "pending", "not_needed"].includes(p.student_status));
export async function startChecks() {
  try { sessionStorage.setItem("fm-checks-only", "1"); } catch { /* ignore */ }
  await q(sb.from("profiles").update({ onboarded: false }).eq("id", state.profile.id));
  await loadProfile();
  go("onboarding");
}
function verifyGate() {
  const o = document.createElement("div");
  o.className = "overlay";
  o.innerHTML = `<div class="match" role="dialog" aria-modal="true"><h3 class="section-title" style="margin:0">One step before saying yes</h3>
    <p>Students subletting their flat only see verified people. Check your identity and student status once (about 2 minutes), then come back to this flat.</p>
    <div class="btns"><button class="btn primary" id="vgo">Verify now</button><button class="btn" id="vno">Keep browsing</button></div></div>`;
  document.body.appendChild(o);
  o.querySelector("#vgo").onclick = () => { o.remove(); startChecks(); };
  o.querySelector("#vno").onclick = () => o.remove();
  o.querySelector("#vgo").focus();
}

// ---------- Seeker: ranked flats, 20 at a time ----------
// The ranking happens in the database (seeker_feed): see supabase/update-4-preferences-reviews-ranking.sql.
function whyLine(l, p) {
  const bits = [];
  if (l.minutes != null) bits.push(`<b>${l.minutes} min</b> to ${esc(p.host_university || "your school")}`);
  bits.push(l.overlap_pct >= 95 ? "<b>covers your whole stay</b>" : `covers <b>${l.overlap_pct}%</b> of your stay`);
  if (l.budget_max) bits.push(l.rent <= l.budget_max ? `<b>${money(l.budget_max - l.rent, l.currency)}</b> under budget` : `<b>${money(l.rent - l.budget_max, l.currency)}</b> over budget`);
  return bits.join(" · ");
}
function outsideLabel(l, p) {
  if (l.tier === 1) return "";
  const why = [];
  if (l.minutes != null && l.minutes > (p.max_commute || 45)) why.push(`${l.minutes} min away`);
  if (l.budget_max && l.rent > l.budget_max * 1.05) why.push(`${money(l.rent - l.budget_max, l.currency)} over budget`);
  if (!l.kind_ok) why.push(l.kind === "room" ? "a room, not a whole flat" : "a whole flat, not a room");
  if (l.missing && l.missing.length) why.push(`no ${l.missing.map((m) => m.toLowerCase()).join(", ")}`);
  if (l.overlap_pct < 60) why.push(`free for ${l.overlap_pct}% of your stay`);
  return why.length ? `<span class="tierlabel">Outside your filters: ${esc(why.join(" · "))}</span>` : "";
}

async function seekerDeck() {
  const p = state.profile;
  const exclude = [];
  const loadBatch = async () => {
    const rows = await q(sb.rpc("seeker_feed", { p_limit: 20, p_exclude: exclude }));
    rows.forEach((r) => exclude.push(r.id));
    return rows;
  };
  const [items, stars] = await Promise.all([loadBatch(), q(sb.from("stars").select("listing_id").eq("user_id", p.id))]);
  const starred = new Set(stars.map((s) => s.listing_id));
  const seen = new Set();
  const needsPrefs = p.budget_max == null;

  view().innerHTML = (needsPrefs ? `<a class="banner" href="#/preferences" style="display:block;margin-bottom:12px;text-decoration:none">
      <b>Set your budget and wishes</b> to get flats ranked for you. →</a>` : "")
    + deckShell(
      `<span class="chip">Near <b>${esc(p.host_university || p.city || "you")}</b></span>${p.budget_max ? `<span class="chip">Up to <b>${money(p.budget_max, items[0]?.currency)}</b></span>` : ""}
       <a class="chip" href="#/preferences" style="text-decoration:none">Preferences ›</a>
       ${needsChecks(p) ? `<button class="chip verify-chip" id="verify-chip">Verify to say yes ›</button>` : ""}`,
      isDesktop() ? "Best matches first. Drag the card right or press the green button if you're interested." : "Best matches first. Tap a card for details, drag right if you're interested, left to pass.");

  const bench = (l) => ({ flats: l.city_flats, avg_interest: l.city_avg_interest, median_eur_m2: l.city_median_eur_m2 });

  // Everything about a flat: in a sheet when a card is tapped on a phone, beside the card on desktop.
  const detailsHTML = (l) => {
    const d = demandFor(l, l, bench(l));
    const photos = (l.photos || []).map((x) => `<img src="${esc(photoUrl(x))}" alt="" loading="lazy">`).join("");
    return `<div class="gallery">${photos || `<div class="plan">${floorPlan(l.kind, l.id)}</div>`}</div>
      ${l.photos?.length > 1 ? `<small class="gallery-hint">${l.photos.length} photos · scroll sideways</small>` : ""}
      <div class="sheet-body">
        ${outsideLabel(l, p)}
        <h2>${esc(l.title)}</h2>
        <div class="row"><span class="price">${money(l.rent, l.currency)}<small> / month</small></span>
          <span class="mscore inline">${l.score}<small>% MATCH</small></span></div>
        <div class="why">${whyLine(l, p)}</div>
        <dl class="facts">
          <dt>Where</dt><dd>${esc([l.area, l.city].filter(Boolean).join(", "))}</dd>
          <dt>Type</dt><dd>${l.kind === "room" ? "Room in a shared flat" : "Whole flat"} · ${l.size_m2} m²</dd>
          <dt>Free</dt><dd>${fmtDate(l.available_from)} → ${fmtDate(l.available_to)}</dd>
          ${l.minutes != null ? `<dt>Commute</dt><dd>About ${l.minutes} min to ${esc(p.host_university || "your campus")}</dd>` : ""}
          <dt>Demand</dt><dd>${d.level === "high" ? `High · ${d.interested} interested this week` : d.level === "low" ? "Low · a hidden gem" : "Normal"}</dd>
        </dl>
        ${(l.tags || []).length ? `<div class="tags">${l.tags.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
        <div class="host">${avatar(l.owner_name, l.owner_id, "", l.owner_avatar)}<span><b>${esc(l.owner_name || "Student")}</b>${l.owner_verified ? ` · <span style="color:var(--ok)">verified</span>` : ""}${l.owner_university ? `<br><small style="color:var(--muted)">${esc(l.owner_university)}</small>` : ""}</span>
          ${starsHTML(l.flat_rating, l.flat_reviews)}</div>
      </div>`;
  };
  const showSide = (l) => {
    const side = document.getElementById("deckSide");
    if (side && isDesktop()) side.innerHTML = `<div class="side-card">${detailsHTML(l)}</div>`;
  };

  const openFlat = (l, decide) => {
    const o = document.createElement("div");
    o.className = "overlay sheet-wrap";
    o.innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(l.title)}">
      <button class="sheet-x" aria-label="Close">${ICON.x}</button>
      ${detailsHTML(l)}
      <div class="sheet-actions"><button class="round pass" data-act="-1" aria-label="Pass">${ICON.x}</button>
        <button class="btn" data-act="star">${starred.has(l.id) ? "Starred" : "Star"}</button>
        <button class="round like" data-act="1" aria-label="Yes">${ICON.yes}</button></div></div>`;
    document.body.appendChild(o);
    const close = () => { o.remove(); document.removeEventListener("keydown", esc_); };
    const esc_ = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", esc_);
    o.addEventListener("click", (e) => { if (e.target === o) close(); });
    o.querySelector(".sheet-x").onclick = close;
    o.querySelector('[data-act="star"]').onclick = () => { document.querySelector(`.card:last-child [data-star="${l.id}"]`)?.click(); close(); };
    o.querySelectorAll('.round[data-act]').forEach((b) => (b.onclick = () => { close(); decide(+b.dataset.act); }));
    o.querySelector(".sheet-x").focus();
  };

  const vc = document.getElementById("verify-chip");
  if (vc) vc.onclick = startChecks;
  mountDeck({
    items,
    refill: loadBatch,
    card: (l) => {
      const d = demandFor(l, l, bench(l));
      const on = starred.has(l.id);
      const photo = l.photos && l.photos[0];
      return `<div class="plan ${photo ? "photo" : ""}" ${photo ? `style="background-image:url('${esc(photoUrl(photo))}')"` : ""}>
          ${photo ? "" : floorPlan(l.kind, l.id)}
          <span class="mscore" title="How well this flat matches your preferences">${l.score}<small>% MATCH</small></span>
          <button class="star ${on ? "on" : ""}" data-star="${l.id}" aria-pressed="${on}" aria-label="Star this flat">${ICON.star}</button>
          ${d.level === "high" ? `<span class="dpill high">High demand</span>` : d.level === "low" ? `<span class="dpill gem">${ICON.gem}Hidden gem</span>` : ""}
          <span class="stamp like">YES</span><span class="stamp nope">PASS</span></div>
        <div class="info compact">
          <h2>${esc(l.title)}</h2>
          <div class="row"><span class="price">${money(l.rent, l.currency)}<small> / month</small></span>
            ${l.minutes != null ? `<span class="commute">${ICON.train}${l.minutes} min to campus</span>` : ""}</div>
          <div class="sub">${esc(l.area || l.city)} · ${l.kind === "room" ? "Room" : "Whole flat"}${l.tier > 1 ? ` · <span class="off">outside your filters</span>` : ""}</div>
          <span class="tapmore">${isDesktop() ? "Details on the right" : "Tap the card for details"}</span></div>`;
    },
    onOpen: (l, decide) => (isDesktop() ? document.getElementById("deckSide")?.scrollIntoView({ behavior: "smooth" }) : openFlat(l, decide)),
    beforeLike: () => {
      if (!needsChecks(state.profile)) return true;
      verifyGate();
      return false;
    },
    onTop: (l, el) => {
      showSide(l);
      if (!seen.has(l.id)) { seen.add(l.id); sb.from("listing_views").insert({ listing_id: l.id, user_id: p.id }).then(() => {}); }
      const b = el.querySelector("[data-star]");
      b.onclick = async (e) => {
        e.stopPropagation();
        const on = !starred.has(l.id);
        on ? starred.add(l.id) : starred.delete(l.id);
        b.classList.toggle("on", on); b.setAttribute("aria-pressed", on);
        try {
          if (on) { await q(sb.from("stars").insert({ user_id: p.id, listing_id: l.id })); toast("Starred. You'll find it in your profile."); }
          else await q(sb.from("stars").delete().eq("user_id", p.id).eq("listing_id", l.id));
        } catch { /* shown */ }
      };
    },
    onSwipe: async (l, liked) => {
      try {
        await q(sb.from("swipes").insert({ listing_id: l.id, seeker_id: p.id, by_role: "seeker", liked }));
        if (!liked) return;
        const m = await findMatch(l.id, p.id);
        const first = (l.owner_name || "The student").split(" ")[0];
        if (m) showMatch(m.id, `${first} wants to sublet to you`, `${l.title}. A chat is open with ${first}. When you both agree on the terms, the lease is filled in for you.`);
        else toast(`Sent. You'll match if ${first} says yes too.`);
      } catch { /* shown */ }
    },
    empty: () => `<div class="empty"><h3>You've seen every flat in the area for now</h3>
      <p>New sublets appear as students confirm their exchange. Widening your preferences brings back more flats.</p>
      <a class="btn" href="#/preferences">Edit preferences</a><a class="btn" href="#/profile">See starred flats</a></div>`,
  });
}

// ---------- Subletter: applicants ranked by compatibility ----------
async function ownerDeck() {
  const p = state.profile;
  const mine = await q(sb.from("listings").select("id, title").eq("owner_id", p.id));
  if (!mine.length) {
    view().innerHTML = `<div class="empty"><span class="eyebrow">Subletter home</span><h3>List your flat to get started</h3>
      <p>Students arriving in your city will see it in their swipe deck. When one says yes, they appear here for you to accept or pass.</p>
      <a class="btn primary" href="#/list">List my flat</a></div>`;
    return;
  }
  const items = (await q(sb.rpc("owner_applicants"))).map((a) => ({ ...a, id: a.listing_id + a.seeker_id }));

  view().innerHTML = deckShell(`<span class="chip">Students who want <b>${mine.length === 1 ? esc(mine[0].title) : `your ${mine.length} flats`}</b></span>
      <a class="chip" href="#/preferences" style="text-decoration:none">Ideal tenant ›</a>
      ${p.role === "seeker" ? `<a class="chip" href="#/profile" style="text-decoration:none">Switch to looking for a flat ›</a>` : ""}`,
    "Best matches first. Drag right to accept and open a chat, left to pass.");

  mountDeck({
    items,
    card: (a) => {
      const why = [];
      why.push(a.cover_pct >= 95 ? "<b>uses your whole free period</b>" : `uses <b>${a.cover_pct}%</b> of your free period`);
      if (a.minutes != null) why.push(`<b>${a.minutes} min</b> from your flat to their school`);
      if (a.wanted_n) why.push(`<b>${a.lifestyle_hits}/${a.wanted_n}</b> of your ideal-tenant wishes`);
      if (a.budget_max) why.push(a.budget_max >= a.rent ? "budget covers your rent" : `budget ${money(a.rent - a.budget_max, a.currency)} below your rent`);
      return `<div class="person-card">${avatar(a.full_name, a.seeker_id, "", a.avatar_url)}
          <span class="mscore" style="right:10px">${a.score}<small>% MATCH</small></span>
          <h2>${esc(a.full_name || "Student")}</h2>
          <div class="checks" style="justify-content:center">${a.id_status === "verified" ? `<span class="pill ok">ID verified</span>` : `<span class="pill wait">ID ${esc(a.id_status)}</span>`}
            ${a.student_status === "verified" ? `<span class="pill ok">Student verified</span>` : `<span class="pill wait">Student ${esc(a.student_status)}</span>`}</div>
          ${starsHTML(a.tenant_rating, a.tenant_reviews)}
          <span class="stamp like">YES</span><span class="stamp nope">PASS</span></div>
        <div class="info">
          ${a.meets_dates ? "" : `<span class="tierlabel">Shorter stay than you'd like</span>`}
          <div class="row"><span>${esc(a.home_university || "")}</span><span style="color:var(--muted)">→ ${esc(a.host_university || "")}</span></div>
          ${a.exchange_from ? `<div class="row"><span class="dates">${fmtShort(a.exchange_from)} → ${fmtDate(a.exchange_to)}</span></div>` : ""}
          <div class="why">${why.join(" · ")}</div>
          ${(a.lifestyle || []).length ? `<div class="tags">${a.lifestyle.map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div>` : ""}
          <div class="host">Interested in <b>${esc(a.listing_title)}</b></div></div>`;
    },
    onSwipe: async (a, liked) => {
      try {
        await q(sb.from("swipes").insert({ listing_id: a.listing_id, seeker_id: a.seeker_id, by_role: "owner", liked }));
        if (!liked) return;
        const m = await findMatch(a.listing_id, a.seeker_id);
        const first = (a.full_name || "The student").split(" ")[0];
        if (m) showMatch(m.id, `You and ${first} matched`, `A chat is open with ${first}. When you both agree on the terms, the lease is filled in for you.`);
      } catch { /* shown */ }
    },
    empty: () => `<div class="empty"><h3>No new requests right now</h3>
      <p>When a student says yes to your flat, they appear here, best match first. Check how demand looks in your profile.</p>
      <a class="btn" href="#/profile">See demand for my flat</a></div>`,
  });
}

// ---------- Landlord ----------
async function landlordHome() {
  const p = state.profile;
  const rows = await q(sb.from("matches")
    .select("id, status, listing:listings(title, area, city, rent, currency), seeker:profiles!matches_seeker_id_fkey(full_name), owner:profiles!matches_owner_id_fkey(id, full_name, avatar_url)")
    .eq("landlord_id", p.id).order("created_at", { ascending: false }));
  if (!rows.length) {
    view().innerHTML = `<div class="empty"><span class="eyebrow">Landlord home</span><h3>No sublet requests yet</h3>
      <p>When your tenant finds a student, they send you an invitation link. Open it while logged in and the request appears here.</p></div>`;
    return;
  }
  const pill = { chatting: `<span class="pill wait">To discuss</span>`, agreed: `<span class="pill red">To sign</span>`, signed: `<span class="pill ok">Signed</span>` };
  view().innerHTML = `<h2 class="section-title">Sublet requests</h2><div class="list">${rows.map((m) => `
    <a class="thread" href="#/chat/${m.id}">${avatar(m.owner?.full_name, m.owner?.id, "", m.owner?.avatar_url)}<span class="t"><strong>${esc(m.listing?.title)}</strong>
      <span>${esc(m.owner?.full_name)} → ${esc(m.seeker?.full_name)} · ${money(m.listing?.rent, m.listing?.currency)}</span></span>${pill[m.status]}</a>`).join("")}</div>`;
}
