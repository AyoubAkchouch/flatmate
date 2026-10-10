// Discover: seekers swipe flats, subletters swipe the students who liked their flat, landlords see their requests.
import { sb, state, view, go, esc, q, toast, ICON, avatar, photoUrl, floorPlan, travelTo, demandFor, fmtShort, fmtDate } from "../lib.js";

const loading = `<p class="loading">Loading…</p>`;

export async function renderDiscover() {
  view().innerHTML = loading;
  const role = state.profile.role;
  if (role === "seeker") return seekerDeck();
  if (role === "subletter") return ownerDeck();
  return landlordHome();
}

// ---------- Swipe mechanics shared by both decks ----------
function mountDeck({ items, card, onSwipe, onTop, empty }) {
  const deckEl = document.getElementById("deck");
  const draw = () => {
    if (!items.length) { deckEl.parentElement.innerHTML = empty(); return; }
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
    el.style.transform = `translateX(${dir * 600}px) rotate(${dir * 25}deg)`;
    const item = items.shift();
    setTimeout(draw, 220);
    onSwipe(item, dir > 0);
  };
  function drag(el) {
    let x0 = null, dx = 0;
    const like = el.querySelector(".stamp.like"), nope = el.querySelector(".stamp.nope");
    el.addEventListener("pointerdown", (e) => { if (e.target.closest("button,a")) return; x0 = e.clientX; dx = 0; el.setPointerCapture(e.pointerId); el.classList.add("dragging"); });
    el.addEventListener("pointermove", (e) => {
      if (x0 === null) return;
      dx = e.clientX - x0;
      el.style.transform = `translateX(${dx}px) rotate(${dx / 18}deg)`;
      if (like) like.style.opacity = Math.max(0, dx / 100);
      if (nope) nope.style.opacity = Math.max(0, -dx / 100);
    });
    const end = () => {
      if (x0 === null) return;
      x0 = null; el.classList.remove("dragging");
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
  <div><div class="deck" id="deck"></div>
  <div class="actions"><button class="round pass" id="pass" aria-label="Pass">${ICON.x}</button><button class="round like" id="like" aria-label="Yes">${ICON.yes}</button></div>
  <p class="hint">${hint}</p></div>
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

// ---------- Seeker: swipe flats ----------
async function seekerDeck() {
  const p = state.profile;
  const [listings, swiped, stars, statsRows] = await Promise.all([
    q(sb.from("listings").select("*, owner:profiles!listings_owner_id_fkey(full_name, home_university, host_university, id_status, student_status)").eq("active", true)),
    q(sb.from("swipes").select("listing_id").eq("seeker_id", p.id).eq("by_role", "seeker")),
    q(sb.from("stars").select("listing_id").eq("user_id", p.id)),
    q(sb.rpc("listing_stats")),
  ]);
  const stats = Object.fromEntries(statsRows.map((r) => [r.listing_id, r]));
  const done = new Set(swiped.map((s) => s.listing_id));
  const starred = new Set(stars.map((s) => s.listing_id));
  const city = (p.city || "").trim().toLowerCase();
  const inCity = listings.filter((l) => !city || l.city.trim().toLowerCase() === city);

  // Flats whose dates overlap your exchange the most come first.
  const overlap = (l) => {
    if (!p.exchange_from || !l.available_from) return 0;
    const a = Math.max(+new Date(p.exchange_from), +new Date(l.available_from));
    const b = Math.min(+new Date(p.exchange_to || p.exchange_from), +new Date(l.available_to || l.available_from));
    return Math.max(0, b - a);
  };
  const items = inCity.filter((l) => l.owner_id !== p.id && !done.has(l.id)).sort((a, b) => overlap(b) - overlap(a));
  const seen = new Set();

  view().innerHTML = deckShell(
    `<span class="chip">City <b>${esc(p.city || "Any")}</b></span>${p.exchange_from ? `<span class="chip">Dates <b>${fmtShort(p.exchange_from)} – ${fmtShort(p.exchange_to)}</b></span>` : ""}`,
    "Drag the card right if you're interested, left to pass. Tap the star to save a flat.");

  mountDeck({
    items,
    card: (l) => {
      const d = demandFor(l, stats, inCity);
      const tr = travelTo(l, p.host_university);
      const on = starred.has(l.id);
      const owner = l.owner || {};
      const photo = l.photos && l.photos[0];
      return `<div class="plan ${photo ? "photo" : ""}" ${photo ? `style="background-image:url('${esc(photoUrl(photo))}')"` : ""}>
          <span class="meta">${l.size_m2} m² · ${esc(l.area || l.city)}</span>${photo ? "" : floorPlan(l.kind, l.id)}
          ${l.photos.length > 1 ? `<span class="count">${ICON.photo.replace("<svg", '<svg style="width:12px;height:12px;vertical-align:-2px"')} ${l.photos.length}</span>` : ""}
          <button class="star ${on ? "on" : ""}" data-star="${l.id}" aria-pressed="${on}" aria-label="Star this flat">${ICON.star}</button>
          ${d.level === "high" ? `<span class="dpill high">High demand${d.basis === "interest" ? ` · ${d.interested} interested this week` : ""}</span>`
            : d.level === "low" ? `<span class="dpill gem">${ICON.gem}Hidden gem</span>` : ""}
          <span class="stamp like">YES</span><span class="stamp nope">PASS</span></div>
        <div class="info"><h2>${esc(l.title)}</h2>
          <div class="row"><span class="price">€${l.rent.toLocaleString("en")}<small> / month</small></span>
            <span class="dates">${fmtShort(l.available_from)} → ${fmtDate(l.available_to)}</span></div>
          ${tr ? `<div class="commute">${ICON.train}<span><b>${tr.minutes} min</b> to ${esc(tr.uni)} by public transport</span></div>` : ""}
          <div class="host">${avatar(owner.full_name, l.owner_id)}<span><b>${esc(owner.full_name || "Student")}</b>${owner.home_university ? ` · ${esc(owner.home_university)}` : ""}
            ${owner.id_status === "verified" ? ` · <span style="color:var(--ok)">verified</span>` : ""}</span></div>
          <div class="tags">${(l.kind === "room" ? ["Room"] : ["Whole flat"]).concat(l.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("")}</div></div>`;
    },
    onTop: (l, el) => {
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
        const first = (l.owner?.full_name || "The student").split(" ")[0];
        if (m) showMatch(m.id, `${first} wants to sublet to you`, `${l.title}. A chat is open with ${first}. Add the landlord when you're ready to agree.`);
        else toast(`Sent. You'll match if ${first} says yes too.`);
      } catch { /* shown */ }
    },
    empty: () => `<div class="empty"><h3>You've seen every flat in ${esc(p.city || "your city")} for now</h3>
      <p>New sublets appear as students confirm their exchange. Your saved flats are in your profile.</p>
      <a class="btn" href="#/profile">See starred flats</a></div>`,
  });
}

// ---------- Subletter: swipe the students who liked your flat ----------
async function ownerDeck() {
  const p = state.profile;
  const mine = await q(sb.from("listings").select("id, title, rent").eq("owner_id", p.id));
  if (!mine.length) {
    view().innerHTML = `<div class="empty"><span class="eyebrow">Subletter home</span><h3>List your flat to get started</h3>
      <p>Students arriving in your city will see it in their swipe deck. When one says yes, they appear here for you to accept or pass.</p>
      <a class="btn primary" href="#/list">List my flat</a></div>`;
    return;
  }
  const ids = mine.map((l) => l.id);
  const byId = Object.fromEntries(mine.map((l) => [l.id, l]));
  const [likes, answered] = await Promise.all([
    q(sb.from("swipes").select("listing_id, seeker_id, created_at, seeker:profiles!swipes_seeker_id_fkey(full_name, home_university, host_university, exchange_from, exchange_to, id_status, student_status)")
      .in("listing_id", ids).eq("by_role", "seeker").eq("liked", true).order("created_at")),
    q(sb.from("swipes").select("listing_id, seeker_id").in("listing_id", ids).eq("by_role", "owner")),
  ]);
  const doneKey = new Set(answered.map((a) => a.listing_id + a.seeker_id));
  const items = likes.filter((l) => !doneKey.has(l.listing_id + l.seeker_id));

  view().innerHTML = deckShell(`<span class="chip">Students who want <b>${mine.length === 1 ? esc(mine[0].title) : `your ${mine.length} flats`}</b></span>`,
    "Drag right to accept and open a chat, left to pass.");

  mountDeck({
    items,
    card: (s) => {
      const st = s.seeker || {};
      return `<div class="person-card">${avatar(st.full_name, s.seeker_id)}
          <h2>${esc(st.full_name || "Student")}</h2>
          <div class="checks" style="justify-content:center">${st.id_status === "verified" ? `<span class="pill ok">ID verified</span>` : `<span class="pill wait">ID ${esc(st.id_status)}</span>`}
            ${st.student_status === "verified" ? `<span class="pill ok">Student verified</span>` : `<span class="pill wait">Student ${esc(st.student_status)}</span>`}</div>
          <span class="stamp like">YES</span><span class="stamp nope">PASS</span></div>
        <div class="info">
          <div class="row"><span>${esc(st.home_university || "")}</span><span style="color:var(--muted)">→ ${esc(st.host_university || "")}</span></div>
          ${st.exchange_from ? `<div class="row"><span class="dates">${fmtShort(st.exchange_from)} → ${fmtDate(st.exchange_to)}</span></div>` : ""}
          <div class="host">Interested in <b>${esc(byId[s.listing_id]?.title)}</b></div></div>`;
    },
    onSwipe: async (s, liked) => {
      try {
        await q(sb.from("swipes").insert({ listing_id: s.listing_id, seeker_id: s.seeker_id, by_role: "owner", liked }));
        if (!liked) return;
        const m = await findMatch(s.listing_id, s.seeker_id);
        const first = (s.seeker?.full_name || "The student").split(" ")[0];
        if (m) showMatch(m.id, `You and ${first} matched`, `A chat is open with ${first}. Add your landlord when you're ready to agree on terms.`);
      } catch { /* shown */ }
    },
    empty: () => `<div class="empty"><h3>No new requests right now</h3>
      <p>When a student says yes to your flat, they appear here. Check how demand looks in your profile.</p>
      <a class="btn" href="#/profile">See demand for my flat</a></div>`,
  });
}

// ---------- Landlord ----------
async function landlordHome() {
  const p = state.profile;
  const rows = await q(sb.from("matches")
    .select("id, status, listing:listings(title, area, city, rent), seeker:profiles!matches_seeker_id_fkey(full_name), owner:profiles!matches_owner_id_fkey(full_name)")
    .eq("landlord_id", p.id).order("created_at", { ascending: false }));
  if (!rows.length) {
    view().innerHTML = `<div class="empty"><span class="eyebrow">Landlord home</span><h3>No sublet requests yet</h3>
      <p>When your tenant finds a student, they send you an invitation link. Open it while logged in and the request appears here.</p></div>`;
    return;
  }
  const pill = { chatting: `<span class="pill wait">To discuss</span>`, agreed: `<span class="pill red">To sign</span>`, signed: `<span class="pill ok">Signed</span>` };
  view().innerHTML = `<h2 class="section-title">Sublet requests</h2><div class="list">${rows.map((m) => `
    <a class="thread" href="#/chat/${m.id}">${avatar(m.owner?.full_name, m.id)}<span class="t"><strong>${esc(m.listing?.title)}</strong>
      <span>${esc(m.owner?.full_name)} → ${esc(m.seeker?.full_name)} · €${m.listing?.rent}</span></span>${pill[m.status]}</a>`).join("")}</div>`;
}
