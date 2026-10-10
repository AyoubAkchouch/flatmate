// A landlord opened an invitation link. Show what it is about and who is signed in, then let them confirm.
import { sb, state, view, go, esc, q, toast, invite, avatar, money } from "../lib.js";

export async function renderInvite() {
  const token = invite.get();
  const p = state.profile;
  view().innerHTML = `<p class="loading">Loading the invitation…</p>`;
  const rows = await q(sb.rpc("invite_preview", { token }));
  const inv = rows && rows[0];
  if (!inv) {
    invite.clear();
    view().innerHTML = `<div class="empty"><h3>This invitation link doesn't work</h3><p>Ask your tenant to copy the link again from their chat.</p><a class="btn" href="#/discover">Continue</a></div>`;
    return;
  }
  const isLandlord = p.role === "landlord";
  const canJoin = isLandlord && !inv.landlord_taken;
  view().innerHTML = `<div class="ob">
    <span class="eyebrow">Invitation</span>
    <h2>Approve a sublet of ${esc(inv.title)}</h2>
    <div class="listing">
      <div class="row"><strong>${esc(inv.area || inv.city || "")}</strong><span class="price">${money(inv.rent, inv.currency)}<small> / month</small></span></div>
      <div class="stats"><span>Tenant <b>${esc(inv.owner_name)}</b></span><span>Wants to sublet to <b>${esc(inv.seeker_name)}</b></span></div>
      ${inv.expected_email ? `<small style="color:var(--muted)">The tenant sent this to ${esc(inv.expected_email)}. Only that account can join.</small>` : ""}
    </div>
    <div class="idcard">${avatar(p.full_name, p.id, "", p.avatar_url)}<span>You're logged in as <b>${esc(p.full_name)}</b><br>
      <span style="color:var(--muted);font-size:13px">${esc(p.email)} · ${isLandlord ? "landlord account" : "student account"}</span></span></div>
    ${inv.landlord_taken ? `<p class="banner">A landlord has already joined this chat. If that's you, open it from your sublet requests.</p>`
      : isLandlord ? "" : `<p class="banner">This invitation is for the landlord of the flat, and you're logged in with a student account. Log out, then sign in or create an account as the landlord.</p>`}
    <div class="stack">
      ${canJoin ? `<button class="btn primary full" id="join">Join the chat as ${esc(p.full_name)}</button>` : ""}
      <button class="btn full" id="switch">${canJoin ? "That's not me: log out" : "Log out and continue as the landlord"}</button>
      <button class="linkbtn" id="decline">Ignore this invitation</button>
    </div></div>`;
  const join = document.getElementById("join");
  if (join) join.onclick = async () => {
    join.disabled = true;
    try {
      const matchId = await q(sb.rpc("accept_invite", { token }));
      invite.clear();
      toast("You joined the chat as the landlord.");
      go("chat/" + matchId);
    } catch { join.disabled = false; }
  };
  // Logging out keeps the invitation, so the right person can pick it up after signing in.
  document.getElementById("switch").onclick = async () => { await sb.auth.signOut(); invite.set(token); go("welcome"); };
  document.getElementById("decline").onclick = () => { invite.clear(); go("discover"); };
}
