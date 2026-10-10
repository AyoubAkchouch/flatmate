// Chats: the list of your matches and the 3-person conversation.
import { sb, state, view, go, esc, q, toast, avatar, fmtShort, fmtDate, copyText } from "../lib.js";

const MATCH_SELECT = `*, listing:listings(id, title, area, city, rent, available_from, available_to, landlord_name, landlord_email),
  seeker:profiles!matches_seeker_id_fkey(id, full_name),
  owner:profiles!matches_owner_id_fkey(id, full_name),
  landlord:profiles!matches_landlord_id_fkey(id, full_name)`;

const STATUS_PILL = (m) => m.status === "signed" ? `<span class="pill ok">Signed</span>`
  : m.status === "agreed" ? `<span class="pill red">To sign</span>`
  : m.landlord_id ? `<span class="pill wait">Landlord in chat</span>` : `<span class="pill gem">Landlord not added</span>`;

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
    return `<a class="thread" href="#/chat/${m.id}">${avatar(other?.full_name, other?.id)}
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

  const draw = () => {
    const l = m.listing || {};
    const ll = m.landlord_id
      ? `<span class="person">${avatar(m.landlord?.full_name, m.landlord_id)}${esc(m.landlord?.full_name)} · landlord</span>`
      : `<span class="person pending"><span class="avatar" style="background:var(--line);color:var(--ink)">+</span>Landlord not added yet</span>`;
    const mailBody = encodeURIComponent(`Hello${l.landlord_name ? " " + l.landlord_name : ""},\n\n${m.owner?.full_name} would like to sublet "${l.title}" to ${m.seeker?.full_name} from ${fmtDate(l.available_from)} to ${fmtDate(l.available_to)}, at €${l.rent} per month.\n\nYou can review the request, talk with both of us and approve it here:\n${inviteLink}\n\nThank you.`);
    view().innerHTML = `<div class="chat">
      <div class="chat-head"><a class="back" href="#/chats">‹ All chats</a>
        <div class="row"><strong>${esc(l.title)}</strong><span class="dates">€${l.rent} · ${fmtShort(l.available_from)} → ${fmtShort(l.available_to)}</span></div>
        <div class="people">
          <span class="person">${avatar(m.seeker?.full_name, m.seeker_id)}${myRole === "seeker" ? "You" : esc(m.seeker?.full_name)} · arriving</span>
          <span class="person">${avatar(m.owner?.full_name, m.owner_id)}${myRole === "owner" ? "You" : esc(m.owner?.full_name)} · tenant</span>${ll}</div></div>
      <div class="msgs" id="msgs">${msgs.map(msgHTML).join("")}</div>
      ${!m.landlord_id && myRole !== "landlord" ? `<div class="invite">
        <strong>Add the landlord to this chat</strong>
        <span style="color:var(--muted)">Send this link to ${esc(l.landlord_name || "the landlord")}. They create an account and join the conversation.</span>
        <code>${esc(inviteLink)}</code>
        <div class="btns"><button class="btn" id="copy">Copy link</button>
          <a class="btn" href="mailto:${esc(l.landlord_email || "")}?subject=${encodeURIComponent("Sublet request for " + (l.title || "your flat"))}&body=${mailBody}">Write an email</a></div></div>` : ""}
      <div class="chat-actions">
        ${m.status === "chatting" ? `<button class="btn red" id="agree" ${m.landlord_id ? "" : "disabled"}>Agree on terms</button>
          ${m.landlord_id ? "" : `<span style="font-size:12px;color:var(--muted);align-self:center">Available once the landlord joins</span>`}`
          : `<a class="btn red" href="#/contract/${m.id}">${m.status === "signed" ? "View signed contract" : "Open the contract to sign"}</a>`}
      </div>
      <form class="composer" id="comp"><input id="msgInput" placeholder="Write a message" autocomplete="off" maxlength="2000"><button class="btn primary">Send</button></form>
    </div>`;
    view().scrollTop = view().scrollHeight;
    const c = document.getElementById("copy");
    if (c) c.onclick = () => copyText(inviteLink);
    const a = document.getElementById("agree");
    if (a) a.onclick = async () => {
      a.disabled = true;
      try { await q(sb.rpc("agree_terms", { m: m.id })); await reloadMatch(); go("contract/" + m.id); }
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
