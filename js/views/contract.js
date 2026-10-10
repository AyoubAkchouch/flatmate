// Contracts: list of agreements to sign, and the signing screen.
import { sb, state, view, esc, q, toast, avatar, fmtDate, signaturePad, starsHTML } from "../lib.js";

// Placeholder templates for the hackathon. Not legal documents.
export const TEMPLATES = {
  standard: { name: "Furnished sublet", desc: "Whole flat, furnished, for the length of an exchange semester.", clauses: [
    "The tenant sublets the whole furnished flat to the subtenant for the dates below.",
    "The rent paid by the subtenant does not exceed the rent paid by the tenant.",
    "The landlord gives written consent to the sublet and its rent by signing below.",
    "The tenant stays responsible toward the landlord under the main lease.",
    "An inventory of the flat is done at move-in and move-out." ] },
  short: { name: "Short stay (under 3 months)", desc: "For summer schools and short programmes.", clauses: [
    "The tenant sublets the flat for a short stay on the dates below.",
    "Rent is paid in full before move-in.",
    "The landlord gives written consent to the sublet and its rent by signing below.",
    "Utilities are included in the rent." ] },
  room: { name: "Room in a shared flat", desc: "One private room, shared kitchen and bathroom.", clauses: [
    "The tenant sublets one private room and shared access to common areas.",
    "The subtenant follows the house rules agreed in the chat.",
    "The landlord gives written consent to the sublet and its rent by signing below.",
    "Rent includes a fair share of utilities." ] },
};

const SELECT = `*, listing:listings(title, area, city, address, rent, available_from, available_to, kind),
  seeker:profiles!matches_seeker_id_fkey(id, full_name), owner:profiles!matches_owner_id_fkey(id, full_name),
  landlord:profiles!matches_landlord_id_fkey(id, full_name)`;

export async function renderContracts() {
  view().innerHTML = `<p class="loading">Loading…</p>`;
  const rows = await q(sb.from("matches").select(SELECT).in("status", ["agreed", "signed"]).order("created_at", { ascending: false }));
  if (!rows.length) {
    view().innerHTML = `<div class="empty"><h3>No contracts yet</h3><p>A contract is ready to sign once you, the other student and the landlord agree in a chat.</p><a class="btn primary" href="#/chats">Open Chats</a></div>`;
    return;
  }
  view().innerHTML = `<h2 class="section-title">Contracts</h2><div class="list">${rows.map((m) => `
    <a class="thread" href="#/contract/${m.id}">${avatar(m.owner?.full_name, m.id)}
      <span class="t"><strong>${esc(m.listing?.title)}</strong><span>${esc(m.owner?.full_name)} → ${esc(m.seeker?.full_name)} · €${m.listing?.rent}</span></span>
      ${m.status === "signed" ? `<span class="pill ok">Signed</span>` : `<span class="pill red">To sign</span>`}</a>`).join("")}</div>`;
}

export async function renderContract(id) {
  view().innerHTML = `<p class="loading">Loading…</p>`;
  const me = state.profile.id;
  let m = await q(sb.from("matches").select(SELECT).eq("id", id).maybeSingle());
  if (!m) { view().innerHTML = `<div class="empty"><h3>This contract isn't available</h3><a class="btn" href="#/contracts">All contracts</a></div>`; return; }
  let c = await q(sb.from("contracts").select("*").eq("match_id", id).single());
  let tpl = c.template;
  let reviews = await q(sb.from("reviews").select("*").eq("match_id", id));
  const myRole = m.seeker_id === me ? "seeker" : m.owner_id === me ? "owner" : "landlord";

  const draw = () => {
    const l = m.listing || {}, t = TEMPLATES[tpl] || TEMPLATES.standard;
    const anySigned = c.seeker_signature || c.owner_signature || c.landlord_signature;
    const all = c.seeker_signature && c.owner_signature && c.landlord_signature;
    const sigRow = (role, label, person) => {
      const sig = c[role + "_signature"], at = c[role + "_signed_at"];
      const mine = role === myRole;
      return `<div class="sig"><div class="row"><strong>${esc(label)}${mine ? " · you" : ""}</strong>
          ${sig ? `<span class="pill ok">Signed ${fmtDate(at)}</span>` : `<span class="pill wait">Waiting</span>`}</div>
        ${sig ? `<img alt="Signature of ${esc(person?.full_name)}" src="${sig}">`
          : mine && m.status !== "chatting" ? `<canvas class="pad" id="pad" aria-label="Draw your signature here"></canvas>
            <div class="btns"><button class="btn" id="clear">Clear</button><button class="btn primary" id="sign">Sign as ${esc(person?.full_name || "you")}</button></div>`
          : `<span style="font-size:13px;color:var(--muted)">${person ? `${esc(person.full_name)} signs from their own account.` : "The landlord hasn't joined yet."}</span>`}</div>`;
    };
    view().innerHTML = `<div>
      <a class="back no-print" href="#/chat/${m.id}">‹ Back to the chat</a>
      <h2 class="section-title" style="margin-top:10px">Sublet contract</h2>
      <p class="note no-print">Hackathon prototype: these templates are placeholders, not legal documents.</p>
      ${anySigned ? "" : `<div class="templates" role="radiogroup" aria-label="Contract template">${Object.entries(TEMPLATES).map(([k, v]) =>
        `<label class="tpl"><input type="radio" name="tpl" value="${k}" ${k === tpl ? "checked" : ""}><span><strong>${v.name}</strong><span>${v.desc}</span></span></label>`).join("")}</div>`}
      <div class="doc"><h3>${t.name} agreement</h3><div class="ref">REF ${m.id.slice(0, 8).toUpperCase()} · ${esc((l.city || "").toUpperCase())}</div>
        <dl><dt>Tenant</dt><dd>${esc(m.owner?.full_name)}</dd><dt>Subtenant</dt><dd>${esc(m.seeker?.full_name)}</dd>
          <dt>Landlord</dt><dd>${esc(m.landlord?.full_name || "Not joined yet")}</dd>
          <dt>Address</dt><dd>${esc(l.address || l.area || "")}${l.city ? ", " + esc(l.city) : ""}</dd>
          <dt>Dates</dt><dd>${fmtDate(l.available_from)} → ${fmtDate(l.available_to)}</dd><dt>Rent</dt><dd>€${l.rent} / month</dd></dl>
        <ol>${t.clauses.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>
        ${all ? `<span class="done">FULLY SIGNED</span>` : ""}</div>
      <div class="sigs">${sigRow("owner", "Tenant", m.owner)}${sigRow("seeker", "Subtenant", m.seeker)}${sigRow("landlord", "Landlord consent", m.landlord)}</div>
      ${all ? `<button class="btn primary full no-print" id="print" style="margin-top:14px">Save as PDF or print</button>` : ""}
      ${m.status === "signed" && myRole !== "landlord" ? reviewBox() : ""}
    </div>`;

    view().querySelectorAll('input[name="tpl"]').forEach((r) => (r.onchange = () => { tpl = r.value; draw(); }));
    const canvas = document.getElementById("pad");
    if (canvas) {
      const pad = signaturePad(canvas);
      document.getElementById("clear").onclick = () => pad.clear();
      document.getElementById("sign").onclick = async (e) => {
        if (pad.isEmpty()) { canvas.style.borderColor = "var(--danger)"; toast("Draw your signature in the box first.", "err"); return; }
        e.target.disabled = true;
        try {
          await q(sb.rpc("sign_contract", { m: m.id, signature: pad.toDataURL(), tpl }));
          toast("Signed.");
          await reload();
        } catch { e.target.disabled = false; }
      };
    }
    const pr = document.getElementById("print");
    if (pr) pr.onclick = () => window.print();
    wireReview();
  };

  // Reviews: the subtenant rates the flat, the tenant rates the subtenant.
  const other = () => (myRole === "seeker" ? m.owner : m.seeker);
  let pick = 0;
  const reviewBox = () => {
    const mine = reviews.find((r) => r.author_id === me);
    const theirs = reviews.find((r) => r.author_id !== me);
    pick = pick || mine?.rating || 0;
    const what = myRole === "seeker" ? "the flat and your stay" : `${esc(other()?.full_name || "your tenant")} as a tenant`;
    return `<section class="psec no-print"><h3>${mine ? "Your review" : `Rate ${what}`}</h3>
      <div class="pref-sec">
        <div class="starpick" role="radiogroup" aria-label="Rating">${[1, 2, 3, 4, 5].map((n) =>
          `<button type="button" data-star="${n}" class="${n <= pick ? "on" : ""}" aria-label="${n} star${n > 1 ? "s" : ""}" aria-checked="${n === pick}" role="radio">★</button>`).join("")}</div>
        <label class="field"><span>Comment <small style="font-weight:400;color:var(--muted)">(optional, shown on ${myRole === "seeker" ? "the flat" : "their profile"})</small></span>
          <textarea id="rv-text" rows="3" maxlength="1000">${esc(mine?.comment || "")}</textarea></label>
        <button class="btn primary" id="rv-save">${mine ? "Update review" : "Publish review"}</button>
      </div>
      ${theirs ? `<div class="review"><div class="row"><strong>${esc(other()?.full_name)} rated ${myRole === "seeker" ? "you as a tenant" : "your flat"}</strong>${starsHTML(theirs.rating, 1).replace(/ <small>.*<\/small>/, "")}</div>
        ${theirs.comment ? `<p>${esc(theirs.comment)}</p>` : ""}</div>` : ""}
    </section>`;
  };
  const wireReview = () => {
    view().querySelectorAll("[data-star]").forEach((b) => b.onclick = () => {
      pick = +b.dataset.star;
      view().querySelectorAll("[data-star]").forEach((x) => { x.classList.toggle("on", +x.dataset.star <= pick); x.setAttribute("aria-checked", +x.dataset.star === pick); });
    });
    const save = document.getElementById("rv-save");
    if (!save) return;
    save.onclick = async () => {
      if (!pick) { toast("Choose between 1 and 5 stars.", "err"); return; }
      save.disabled = true;
      try {
        await q(sb.rpc("submit_review", { m: m.id, stars: pick, note: document.getElementById("rv-text").value }));
        reviews = await q(sb.from("reviews").select("*").eq("match_id", id));
        toast("Thanks, your review is published.");
        draw();
      } catch { save.disabled = false; }
    };
  };

  const reload = async () => {
    m = await q(sb.from("matches").select(SELECT).eq("id", id).single());
    c = await q(sb.from("contracts").select("*").eq("match_id", id).single());
    tpl = c.template;
    draw();
  };

  draw();
  const channel = sb.channel("contract-" + id)
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "contracts", filter: `match_id=eq.${id}` }, () => {
      // Don't wipe a signature someone is drawing right now.
      if (!document.getElementById("pad") || document.getElementById("pad").dataset.touched !== "1") reload().catch(() => {});
    })
    .subscribe();
  state.cleanup = () => sb.removeChannel(channel);
}
