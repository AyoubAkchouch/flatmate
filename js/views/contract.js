// Contracts: the list of leases, and the lease itself with its signatures.
import { sb, state, view, esc, q, toast, avatar, fmtDate, signaturePad, starsHTML, money, feeSplit } from "../lib.js";

// Three versions of the sample lease. Hackathon prototype: not legal documents.
export const TEMPLATES = {
  standard: { name: "Whole flat", desc: "The whole flat, furnished, for an exchange semester." },
  short: { name: "Short stay (under 3 months)", desc: "Summer schools and short programmes. Rent paid upfront." },
  room: { name: "Room in a shared flat", desc: "One private room, shared kitchen and bathroom." },
};

const SELECT = `*, listing:listings(title, area, city, address, rent, currency, available_from, available_to, kind, size_m2, tags, landlord_name),
  seeker:profiles!matches_seeker_id_fkey(id, full_name, avatar_url, home_university, host_university),
  owner:profiles!matches_owner_id_fkey(id, full_name, avatar_url, home_university),
  landlord:profiles!matches_landlord_id_fkey(id, full_name, avatar_url)`;

export async function renderContracts() {
  view().innerHTML = `<p class="loading">Loading…</p>`;
  const rows = await q(sb.from("matches").select(SELECT).in("status", ["agreed", "signed"]).order("created_at", { ascending: false }));
  if (!rows.length) {
    view().innerHTML = `<div class="empty"><h3>No leases yet</h3><p>When you and the other student both agree on the terms in a chat, the lease appears here with your names filled in, ready to sign.</p><a class="btn primary" href="#/chats">Open Chats</a></div>`;
    return;
  }
  const me = state.profile.id;
  view().innerHTML = `<h2 class="section-title">Leases</h2><div class="list">${rows.map((m) => {
    const other = m.seeker_id === me ? m.owner : m.seeker;
    return `<a class="thread" href="#/contract/${m.id}">${avatar(other?.full_name, other?.id, "", other?.avatar_url)}
      <span class="t"><strong>${esc(m.listing?.title)}</strong><span>${esc(m.owner?.full_name)} → ${esc(m.seeker?.full_name)} · ${money(m.listing?.rent, m.listing?.currency)}</span></span>
      ${m.status === "signed" ? `<span class="pill ok">Signed</span>` : `<span class="pill red">To sign</span>`}</a>`;
  }).join("")}</div>`;
}

// Roughly how long the stay is, in words.
function lengthInWords(from, to) {
  if (!from || !to) return "";
  const days = Math.round((new Date(to) - new Date(from)) / 86400000);
  if (days < 0) return "";
  if (days < 60) return `${Math.round(days / 7)} weeks`;
  const months = Math.round((days / 30.44) * 2) / 2;
  return `about ${String(months).replace(".5", "½")} months`;
}
const monthsBetween = (from, to) => Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000 / 30.44));

export async function renderContract(id) {
  view().innerHTML = `<p class="loading">Loading…</p>`;
  const me = state.profile.id;
  let m = await q(sb.from("matches").select(SELECT).eq("id", id).maybeSingle());
  if (!m) { view().innerHTML = `<div class="empty"><h3>This lease isn't available</h3><a class="btn" href="#/contracts">All leases</a></div>`; return; }
  let c = await q(sb.from("contracts").select("*").eq("match_id", id).single());
  let reviews = await q(sb.from("reviews").select("*").eq("match_id", id));
  const myRole = m.seeker_id === me ? "seeker" : m.owner_id === me ? "owner" : "landlord";
  const nobodySigned = () => !(c.seeker_signature || c.owner_signature || c.landlord_signature);
  // Before anyone signs, start from the version that fits the flat.
  const fitting = () => {
    const l = m.listing || {};
    if (l.kind === "room") return "room";
    if (l.available_from && l.available_to && (new Date(l.available_to) - new Date(l.available_from)) / 86400000 < 92) return "short";
    return "standard";
  };
  let tpl = nobodySigned() && c.template === "standard" ? fitting() : c.template;
  let readOk = false;

  // Not agreed yet: the lease isn't shown until both students agree on the terms.
  if (m.status === "chatting") {
    view().innerHTML = `<div class="empty"><h3>The lease opens once you both agree</h3>
      <p>Talk through the dates, rent and house rules in the chat. When you and the other student both tap <b>Agree on terms</b>, the lease is filled in with your names and details, ready to sign.</p>
      <a class="btn primary" href="#/chat/${m.id}">Back to the chat</a></div>`;
    return;
  }

  const draw = () => {
    const l = m.listing || {}, t = TEMPLATES[tpl] || TEMPLATES.standard;
    const all = c.seeker_signature && c.owner_signature && (!m.landlord_id || c.landlord_signature);
    const cur = l.currency || "EUR";
    const F = (v) => `<span class="fill">${esc(v)}</span>`; // a detail filled in automatically
    const owner = m.owner?.full_name || "the tenant", seeker = m.seeker?.full_name || "the subtenant";
    const landlordName = m.landlord?.full_name || l.landlord_name || "";
    const agreedOn = [m.seeker_agreed_at, m.owner_agreed_at].filter(Boolean).sort().pop() || m.created_at;
    const place = [l.address || l.area, l.address && l.area ? l.area : null, l.city].filter(Boolean).join(", ");
    const included = (l.tags || []).filter((x) => x !== "Near public transport" && x !== "Quiet street");
    const bills = (l.tags || []).includes("Bills included");
    const short = tpl === "short", room = tpl === "room";
    const split = feeSplit(l.rent);
    const fee = { total: (c.seeker_fee ?? split.seeker) + (c.owner_fee ?? split.owner), seeker: c.seeker_fee ?? split.seeker, owner: c.owner_fee ?? split.owner };
    const paid = (role) => !!c[role + "_paid_at"];
    const iPay = myRole === "seeker" || myRole === "owner";

    const clauses = [
      ["The parties", `This sublease is made on ${F(fmtDate(agreedOn))} between ${F(owner)}${m.owner?.home_university ? `, a student at ${F(m.owner.home_university)}` : ""} (the <b>Tenant</b>), who rents the flat below${landlordName ? ` from ${F(landlordName)} (the <b>Landlord</b>)` : ""}, and ${F(seeker)}${m.seeker?.home_university ? `, a student at ${F(m.seeker.home_university)}` : ""}${m.seeker?.host_university ? ` on exchange at ${F(m.seeker.host_university)}` : ""} (the <b>Subtenant</b>).`],
      ["The flat", `The Tenant sublets to the Subtenant ${room ? "one private, furnished room, with shared use of the kitchen, bathroom and living areas," : "the whole furnished flat"} at ${F(place)}${l.size_m2 ? ` (${F(l.size_m2 + " m²")}${room ? " for the room" : ""})` : ""}.${included.length ? ` Included: ${F(included.join(", ").toLowerCase())}.` : ""}`],
      ["Length of the stay", `From ${F(fmtDate(l.available_from))} to ${F(fmtDate(l.available_to))}${lengthInWords(l.available_from, l.available_to) ? ` (${lengthInWords(l.available_from, l.available_to)})` : ""}. The Subtenant hands back the keys by noon on the last day. The sublease ends on that date without further notice.`],
      ["Rent", short
        ? `The rent is ${F(money(l.rent, cur) + " per month")}, ${F(money(l.rent * monthsBetween(l.available_from, l.available_to), cur))} for the whole stay, paid in full to the Tenant before move-in.`
        : `The rent is ${F(money(l.rent, cur) + " per month")}, paid to the Tenant by the 1st of each month. It is not more than the rent the Tenant pays on their own lease.`],
      ["Security deposit", `The Subtenant pays a deposit of ${F(money(l.rent, cur))} (one month's rent) before move-in. The Tenant returns it within 30 days of move-out, minus the cost of any damage beyond normal wear, with receipts.`],
      ["Bills", bills ? "Electricity, heating, water and internet are included in the rent." : room ? "The Subtenant pays a fair share of electricity, heating, water and internet, split with the other flatmates as agreed in the chat." : "The Subtenant pays the electricity, heating and internet used during the stay, as agreed in the chat."],
      ["Using the flat", `The Subtenant lives in the flat personally, doesn't sublet it to anyone else, respects the building's rules and neighbours, and keeps it clean.${room ? " House rules agreed in the chat with the other flatmates apply." : ""}`],
      ["The main lease", "The Tenant remains responsible toward the Landlord under the main lease. The Subtenant agrees to respect the parts of the main lease that apply to how the flat is used."],
      ["Landlord's consent", m.landlord_id
        ? `${F(m.landlord?.full_name || "The Landlord")} gives written consent to this sublease and its rent by signing below.`
        : `The Tenant confirms they have the Landlord's written permission to sublet${landlordName ? ` (${F(landlordName)})` : ""}, where their lease requires it. The Landlord can also join the chat and sign below.`],
      ["Check-in and check-out", "The Tenant and Subtenant go through the flat together on arrival and departure, and share photos of its condition in the chat."],
      ["Ending early", short ? "The stay can only end early if both students agree in writing. Rent already paid for nights not used is refunded only if the Tenant finds someone else." : "Either student can end the sublease early with 30 days' written notice in the chat. Rent is due until the end of the notice period."],
      ["Flatmate service fee", `Flatmate's fee is ${F(money(fee.total, cur))}, 6% of one month's rent. ${F(owner)} pays ${F(money(fee.owner, cur))} and ${F(seeker)} pays ${F(money(fee.seeker, cur))}, before signing. It is not part of the rent and isn't refunded if the sublease ends early.`],
      ["Signing electronically", "Each party signs from their own verified Flatmate account. The drawn signature, the signer's name and the time are recorded with this lease and have the same value as a signature on paper."],
    ];

    const sigRow = (role, label, person) => {
      const sig = c[role + "_signature"], at = c[role + "_signed_at"];
      const mine = role === myRole;
      return `<div class="sig"><div class="row"><strong>${esc(label)} · ${esc(person?.full_name || "")}${mine ? " (you)" : ""}</strong>
          ${sig ? `<span class="pill ok">Signed</span>` : `<span class="pill wait">Waiting</span>`}</div>
        ${sig ? `<img alt="Signature of ${esc(person?.full_name)}" src="${sig}"><span class="sigmeta">Signed electronically by ${esc(person?.full_name)} on ${new Date(at).toLocaleString("en-GB", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>`
          : mine && iPay && !paid(role) ? `<span class="sigmeta locked">Pay your half of the service fee above to sign.</span>`
          : mine ? `<label class="readok"><input type="checkbox" id="readok" ${readOk ? "checked" : ""}> I've read the whole lease above and I agree to sign it electronically.</label>
            <canvas class="pad" id="pad" aria-label="Draw your signature here"></canvas>
            <div class="btns"><button class="btn" id="clear">Clear</button><button class="btn primary" id="sign" ${readOk ? "" : "disabled"}>Sign as ${esc(person?.full_name || "you")}</button></div>
            <small class="sigmeta">Draw your signature with your finger or mouse.</small>`
          : `<span class="sigmeta">${esc(person?.full_name || "They")} signs from their own account.</span>`}</div>`;
    };

    view().innerHTML = `<div>
      <a class="back no-print" href="#/chat/${m.id}">‹ Back to the chat</a>
      <h2 class="section-title" style="margin-top:10px">Sublease agreement</h2>
      <p class="note no-print">A sample lease for this prototype, not legal advice. The <span class="fill">highlighted</span> details were filled in from your profiles and the listing.</p>
      ${nobodySigned() ? `<div class="templates no-print" role="radiogroup" aria-label="Type of lease">${Object.entries(TEMPLATES).map(([k, v]) =>
        `<label class="tpl"><input type="radio" name="tpl" value="${k}" ${k === tpl ? "checked" : ""}><span><strong>${v.name}</strong><span>${v.desc}</span></span></label>`).join("")}</div>` : ""}
      <article class="doc lease">
        <h3>Sublease agreement</h3><div class="ref">${esc(t.name.toUpperCase())} · REF ${m.id.slice(0, 8).toUpperCase()} · ${esc((l.city || "").toUpperCase())}</div>
        <ol>${clauses.map(([h, b]) => `<li><b>${esc(h)}.</b> ${b}</li>`).join("")}</ol>
        ${all ? `<span class="done">FULLY SIGNED</span>` : ""}
      </article>
      <section class="feebox no-print">
        <div class="row"><h3>Flatmate service fee</h3><span class="feetotal">${money(fee.total, cur)}</span></div>
        <p>6% of one month's rent (${money(l.rent, cur)}), split between the two students. Paid once, before signing.</p>
        <div class="feerows">
          ${[["owner", m.owner, fee.owner], ["seeker", m.seeker, fee.seeker]].map(([role, person, amt]) => `<div class="feerow">
            ${avatar(person?.full_name, person?.id, "", person?.avatar_url)}<span class="t"><b>${esc(person?.full_name || "")}${role === myRole ? " (you)" : ""}</b><small>${role === "owner" ? "Tenant" : "Subtenant"} · ${money(amt, cur)}</small></span>
            ${paid(role) ? `<span class="pill ok">Paid</span>` : role === myRole ? `<button class="btn primary" id="pay">Pay ${money(amt, cur)}</button>` : `<span class="pill wait">Not paid yet</span>`}</div>`).join("")}
        </div>
        ${iPay && paid(myRole) ? `<small class="sigmeta">Your receipt: ${esc(c[myRole + "_payment_ref"] || "")} · ${fmtDate(c[myRole + "_paid_at"])}</small>` : ""}
      </section>
      <h3 class="section-title" style="font-size:20px">Signatures</h3>
      <div class="sigs">${sigRow("owner", "Tenant", m.owner)}${sigRow("seeker", "Subtenant", m.seeker)}${m.landlord_id ? sigRow("landlord", "Landlord's consent", m.landlord) : ""}</div>
      ${all ? `<button class="btn primary full no-print" id="print" style="margin-top:14px">Save as PDF or print</button>`
        : `<p class="note no-print" style="margin-top:12px">${m.landlord_id ? "The lease is complete when the tenant, the subtenant and the landlord have signed." : "The lease is complete when both students have signed."}</p>`}
      ${m.status === "signed" && myRole !== "landlord" ? reviewBox() : ""}
    </div>`;

    view().querySelectorAll('input[name="tpl"]').forEach((r) => (r.onchange = () => { tpl = r.value; draw(); }));
    const canvas = document.getElementById("pad");
    if (canvas) {
      const pad = signaturePad(canvas);
      const signBtn = document.getElementById("sign");
      document.getElementById("readok").onchange = (e) => { readOk = e.target.checked; signBtn.disabled = !readOk; };
      document.getElementById("clear").onclick = () => pad.clear();
      signBtn.onclick = async () => {
        if (pad.isEmpty()) { canvas.style.borderColor = "var(--danger)"; toast("Draw your signature in the box first.", "err"); return; }
        signBtn.disabled = true;
        try {
          await q(sb.rpc("sign_contract", { m: m.id, signature: pad.toDataURL(), tpl }));
          toast("Signed. Thank you.");
          await reload();
        } catch { signBtn.disabled = false; }
      };
    }
    const payBtn = document.getElementById("pay");
    if (payBtn) payBtn.onclick = () => checkout(myRole === "seeker" ? fee.seeker : fee.owner, cur, l);
    const pr = document.getElementById("print");
    if (pr) pr.onclick = () => window.print();
    wireReview();
  };

  // Prototype checkout: no card details are taken and nothing is charged.
  const checkout = (amount, cur, l) => {
    const o = document.createElement("div");
    o.className = "overlay sheet-wrap";
    let method = "card";
    const methods = [["card", "Card"], ["apple", "Apple Pay"], ["paypal", "PayPal"]];
    o.innerHTML = `<div class="sheet checkout" role="dialog" aria-modal="true" aria-label="Pay the service fee">
      <div class="sheet-body">
        <span class="eyebrow">Flatmate service fee</span>
        <h2>${money(amount, cur)}</h2>
        <dl class="facts"><dt>For</dt><dd>${esc(l.title)}</dd><dt>Rent</dt><dd>${money(l.rent, cur)} / month</dd>
          <dt>Fee</dt><dd>6% of one month's rent, your half</dd></dl>
        <div class="seg" role="radiogroup" aria-label="Payment method">${methods.map(([k, t]) =>
          `<button type="button" data-m="${k}" aria-pressed="${k === method}">${t}</button>`).join("")}</div>
        <p class="note">Prototype checkout: no card details are taken and no money is charged. A real launch would use a payment provider such as Stripe.</p>
        <button class="btn primary full" id="paynow">Pay ${money(amount, cur)}</button>
        <button class="linkbtn" id="paycancel">Cancel</button>
      </div></div>`;
    document.body.appendChild(o);
    o.querySelectorAll("[data-m]").forEach((b) => (b.onclick = () => { method = b.dataset.m; o.querySelectorAll("[data-m]").forEach((x) => x.setAttribute("aria-pressed", x === b)); }));
    o.querySelector("#paycancel").onclick = () => o.remove();
    o.addEventListener("click", (e) => { if (e.target === o) o.remove(); });
    o.querySelector("#paynow").onclick = async (e) => {
      e.target.disabled = true; e.target.textContent = "Processing…";
      try {
        const ref = await q(sb.rpc("pay_fee", { m: m.id }));
        o.remove();
        toast(`Paid. Receipt ${ref}. You can sign the lease now.`);
        await reload();
      } catch { e.target.disabled = false; e.target.textContent = `Pay ${money(amount, cur)}`; }
    };
    o.querySelector("#paynow").focus();
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
    if (!nobodySigned()) tpl = c.template;
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
