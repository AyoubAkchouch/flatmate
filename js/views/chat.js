// Chats: the list of your matches and the 3-person conversation.
import { sb, state, view, go, esc, q, toast, avatar, fmtShort, fmtDate, copyText, money } from "../lib.js";

const MATCH_SELECT = `*, listing:listings(id, title, area, city, rent, currency, available_from, available_to, landlord_name, landlord_email),
  seeker:profiles!matches_seeker_id_fkey(id, full_name, avatar_url),
  owner:profiles!matches_owner_id_fkey(id, full_name, avatar_url),
  landlord:profiles!matches_landlord_id_fkey(id, full_name, avatar_url)`;

const STATUS_PILL = (m) => m.status === "signed" ? `<span class="pill ok">Signed</span>`
  : m.status === "agreed" ? `<span class="pill red">To sign</span>`
  : m.seeker_agreed_at || m.owner_agreed_at ? `<span class="pill wait">1 of 2 agreed</span>` : `<span class="pill gem">Chatting</span>`;

export async function renderChats() {
  view().innerHTML = `<p class="loading">Loading…</p>`;
  const me = state.profile.id;
  const rows = await q(sb.from("matches").select(MATCH_SELECT).order("created_at", { ascending: false }));
  if (!rows.length) {
    view().innerHTML = `<div class="empty"><h3>No matches yet</h3><p>When you and another student both say yes, a chat opens here.</p><a class="btn primary" href="#/discover">Go to Discover</a></div>`;
    return;
  }
  const last = await q(sb.from("messages").select("match_id, body, created_at").in("match_id", rows.map((r) => r.id)).order("id", { ascending: false }).limit(300));
  const lastBy = {};
  last.forEach((m) => { if (!lastBy[m.match_id]) lastBy[m.match_id] = m; });
  view().innerHTML = `<h2 class="section-title">Chats</h2><div class="list">${rows.map((m) => {
    const other = m.seeker_id === me ? m.owner : m.seeker;
    return `<a class="thread" href="#/chat/${m.id}">${avatar(other?.full_name, other?.id, "", other?.avatar_url)}
      <span class="t"><strong>${esc(other?.full_name)} · ${esc(m.listing?.area || m.listing?.city || "")}</strong><span>${esc(lastBy[m.id]?.body || "")}</span></span>${STATUS_PILL(m)}</a>`;
  }).join("")}</div>`;
}

export async function renderChat(id) {
  view().innerHTML = `<p class="loading">Loading…</p>`;
  const me = state.profile.id;
  let m = await q(sb.from("matches").select(MATCH_SELECT).eq("id", id).maybeSingle());
  if (!m) { view().innerHTML = `<div class="empty"><h3>This chat isn't available</h3><p>It may have been removed, or you're not part of it.</p><a class="btn" href="#/chats">All chats</a></div>`; return; }
  let msgs = await q(sb.from("messages").select("*").eq("match_id", id).order("id"));

  const myRole = m.seeker_id === me ? "seeker" : m.owner_id === me ? "owner" : "landlord";
  const names = () => ({ [m.seeker_id]: m.seeker?.full_name, [m.owner_id]: m.owner?.full_name, ...(m.landlord_id ? { [m.landlord_id]: m.landlord?.full_name } : {}) });
  const inviteLink = `${location.origin}${location.pathname}#/invite/${m.invite_token}`;

  const msgHTML = (x) => {
    if (x.kind === "system") return `<div class="sys">${esc(x.body)}</div>`;
    const mine = x.sender_id === me, isLandlord = x.sender_id === m.landlord_id;
    const who = mine ? "You" : `${names()[x.sender_id] || "Someone"}${isLandlord ? " (landlord)" : ""}`;
    return `<div class="msg ${mine ? "me" : ""} ${isLandlord && !mine ? "landlord" : ""}"><span class="who">${esc(who)}</span><span class="b">${esc(x.body)}</span></div>`;
  };

  // Agreeing on terms: each student confirms. Then the lease is filled in with both names.
  const actions = () => {
    const l = m.listing || {};
    if (m.status !== "chatting") return `<a class="btn red" href="#/contract/${m.id}">${m.status === "signed" ? "View the signed lease" : "Read and sign the lease"}</a>`;
    const first = (p) => esc((p?.full_name || "").split(" ")[0] || "They");
    const terms = `${money(l.rent, l.currency)} a month, ${fmtShort(l.available_from)} → ${fmtDate(l.available_to)}`;
    if (myRole === "landlord") return `<span class="agree-note">The two students agree on the terms first (${terms}). You then give your consent by signing the lease.</span>`;
    const iAgreed = myRole === "seeker" ? m.seeker_agreed_at : m.owner_agreed_at;
    const other = myRole === "seeker" ? m.owner : m.seeker;
    const theyAgreed = myRole === "seeker" ? m.owner_agreed_at : m.seeker_agreed_at;
    return iAgreed
      ? `<span class="agree-note"><b>You agreed</b> to ${terms}. Waiting for ${first(other)} to agree; the lease opens as soon as they do.</span>`
      : `<button class="btn red" id="agree">Agree on terms</button>
         <span class="agree-note">${theyAgreed ? `<b>${first(other)} already agreed.</b> ` : ""}${terms}. Once you both agree, the lease is filled in with your names.</span>`;
  };

  const draw = () => {
    const l = m.listing || {};
    const ll = m.landlord_id
      ? `<span class="person">${avatar(m.landlord?.full_name, m.landlord_id, "", m.landlord?.avatar_url)}${esc(m.landlord?.full_name)} · landlord</span>`
      : `<span class="person pending"><span class="avatar" style="background:var(--line);color:var(--ink)">+</span>Landlord not added yet</span>`;
    const mailBody = encodeURIComponent(`Hello${l.landlord_name ? " " + l.landlord_name : ""},\n\n${m.owner?.full_name} would like to sublet "${l.title}" to ${m.seeker?.full_name} from ${fmtDate(l.available_from)} to ${fmtDate(l.available_to)}, at ${money(l.rent, l.currency)} per month.\n\nYou can review the request, talk with both of us and approve it here:\n${inviteLink}\n\nThank you.`);
    view().innerHTML = `<div class="chat">
      <div class="chat-head"><a class="back" href="#/chats">‹ All chats</a>
        <div class="row"><strong>${esc(l.title)}</strong><span class="dates">${money(l.rent, l.currency)} · ${fmtShort(l.available_from)} → ${fmtShort(l.available_to)}</span></div>
        <div class="people">
          <span class="person">${avatar(m.seeker?.full_name, m.seeker_id, "", m.seeker?.avatar_url)}${myRole === "seeker" ? "You" : esc(m.seeker?.full_name)} · arriving</span>
          <span class="person">${avatar(m.owner?.full_name, m.owner_id, "", m.owner?.avatar_url)}${myRole === "owner" ? "You" : esc(m.owner?.full_name)} · tenant</span>${ll}</div></div>
      <div class="msgs" id="msgs">${msgs.map(msgHTML).join("")}</div>
      ${!m.landlord_id && myRole !== "landlord" && m.status !== "signed" ? `<div class="invite">
        <strong>Add the landlord to this chat <span style="font-weight:400;color:var(--muted)">(recommended)</span></strong>
        <span style="color:var(--muted)">Most leases need the landlord's written consent to sublet. Send this link to ${esc(l.landlord_name || "the landlord")}: they join the conversation and sign the lease to give their consent.</span>
        <code>${esc(inviteLink)}</code>
        <div class="btns"><button class="btn" id="copy">Copy link</button>
          <a class="btn" href="mailto:${esc(l.landlord_email || "")}?subject=${encodeURIComponent("Sublet request for " + (l.title || "your flat"))}&body=${mailBody}">Write an email</a></div></div>` : ""}
      <div class="chat-actions">${actions()}</div>
      <form class="composer" id="comp"><input id="msgInput" placeholder="Write a message" autocomplete="off" maxlength="2000"><button class="btn primary">Send</button></form>
    </div>`;
    view().scrollTop = view().scrollHeight;
    const c = document.getElementById("copy");
    if (c) c.onclick = () => copyText(inviteLink);
    const a = document.getElementById("agree");
    if (a) a.onclick = async () => {
      a.disabled = true;
      try {
        await q(sb.rpc("agree_terms", { m: m.id }));
        await reloadMatch();
        if (m.status !== "chatting") go("contract/" + m.id);
        else toast("Noted. The lease opens when the other student agrees too.");
      }
      catch { a.disabled = false; }
    };
    document.getElementById("comp").onsubmit = async (e) => {
      e.preventDefault();
      const input = document.getElementById("msgInput");
      const body = input.value.trim();
      if (!body) return;
      input.value = "";
      try {
        const row = await q(sb.from("messages").insert({ match_id: m.id, sender_id: me, body }).select().single());
        addMessage(row);
      } catch { input.value = body; }
      document.getElementById("msgInput").focus();
    };
  };

  const addMessage = (row) => {
    if (msgs.some((x) => x.id === row.id)) return;
    msgs.push(row);
    const box = document.getElementById("msgs");
    if (!box) return;
    box.insertAdjacentHTML("beforeend", msgHTML(row));
    view().scrollTop = view().scrollHeight;
  };
  const reloadMatch = async () => {
    m = await q(sb.from("matches").select(MATCH_SELECT).eq("id", id).single());
    msgs = await q(sb.from("messages").select("*").eq("match_id", id).order("id"));
    const typing = document.getElementById("msgInput")?.value || "";
    draw();
    document.getElementById("msgInput").value = typing;
  };

  draw();

  // Live updates: new messages, and changes like the landlord joining.
  const channel = sb.channel("chat-" + id)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "messages", filter: `match_id=eq.${id}` }, (payload) => addMessage(payload.new))
    .on("postgres_changes", { event: "UPDATE", schema: "public", table: "matches", filter: `id=eq.${id}` }, () => reloadMatch().catch(() => {}))
    .subscribe();
  state.cleanup = () => sb.removeChannel(channel);
}
