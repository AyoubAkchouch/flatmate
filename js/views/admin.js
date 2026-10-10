// Admin: review ID and student documents, and switch demo mode on or off.
import { sb, state, view, esc, q, toast, avatar, fmtDate } from "../lib.js";

export async function renderAdmin() {
  if (!state.profile.is_admin) {
    view().innerHTML = `<div class="empty"><h3>Admins only</h3><p>This page is for the team reviewing verification checks.</p><a class="btn" href="#/profile">Back to profile</a></div>`;
    return;
  }
  view().innerHTML = `<p class="loading">Loading…</p>`;
  const [settings, rows] = await Promise.all([
    q(sb.from("app_settings").select("*").eq("id", 1).single()),
    q(sb.from("verifications").select("*, user:profiles!verifications_user_id_fkey(full_name, email, home_university, avatar_url)").order("created_at", { ascending: false }).limit(100)),
  ]);
  const pending = rows.filter((r) => r.status === "pending");
  const recent = rows.filter((r) => r.status !== "pending").slice(0, 20);

  const links = {};
  await Promise.all(pending.flatMap((r) => r.files.map(async (path) => {
    const { data } = await sb.storage.from("verification").createSignedUrl(path, 600);
    links[path] = data?.signedUrl;
  })));

  const kindLabel = (k) => (k === "identity" ? "Identity" : "Student status");
  view().innerHTML = `<div>
    <a class="back" href="#/profile">‹ Profile</a>
    <h2 class="section-title" style="margin-top:10px">Verification checks</h2>
    <div class="review">
      <strong>${settings.auto_approve_checks ? "Demo mode is on" : "Manual review is on"}</strong>
      <span style="font-size:14px;color:var(--muted)">${settings.auto_approve_checks
        ? "Every uploaded document is approved instantly. Good for the demo, not for real users."
        : "New documents wait here until you approve or reject them."}</span>
      <div class="btns"><button class="btn" id="toggle">${settings.auto_approve_checks ? "Switch to manual review" : "Switch to demo mode"}</button></div>
    </div>
    <div class="review" style="margin-top:10px">
      <strong>${settings.allow_early_reviews ? "Reviews allowed as soon as a contract is signed" : "Reviews only after move-out"}</strong>
      <span style="font-size:14px;color:var(--muted)">${settings.allow_early_reviews
        ? "Handy for the demo. For real use, students should only review once the stay is over."
        : "Students can review each other once the sublet's end date has passed."}</span>
      <div class="btns"><button class="btn" id="toggle-rev">${settings.allow_early_reviews ? "Only after move-out" : "Allow right after signing"}</button></div>
    </div>
    <section class="psec"><h3>Waiting for review (${pending.length})</h3>
      ${pending.length ? pending.map((r) => `<div class="review">
        <div class="host">${avatar(r.user?.full_name, r.user_id, "", r.user?.avatar_url)}<span><b>${esc(r.user?.full_name)}</b> · ${esc(r.user?.email)}<br>${kindLabel(r.kind)}${r.document_type ? ` · ${esc(r.document_type.replace("_", " "))}` : ""} · ${fmtDate(r.created_at)}</span></div>
        <div class="thumbs">${r.files.map((f) => links[f]
          ? (/\.pdf$/i.test(f) ? `<a class="btn" href="${esc(links[f])}" target="_blank" rel="noopener">Open PDF</a>` : `<a href="${esc(links[f])}" target="_blank" rel="noopener"><img src="${esc(links[f])}" alt="Uploaded document"></a>`)
          : `<span class="pill red">File missing</span>`).join("")}</div>
        <div class="btns"><button class="btn primary" data-ok="${r.id}">Approve</button><button class="btn" data-no="${r.id}">Reject</button></div></div>`).join("")
        : `<p class="lead">Nothing to review.</p>`}</section>
    <section class="psec"><h3>Recently decided</h3>
      ${recent.length ? recent.map((r) => `<div class="srow"><span class="t"><strong>${esc(r.user?.full_name)}</strong><span>${kindLabel(r.kind)} · ${fmtDate(r.created_at)}</span></span>
        ${r.status === "verified" ? `<span class="pill ok">Approved</span>` : `<span class="pill red">Rejected</span>`}</div>`).join("") : `<p class="lead">No decisions yet.</p>`}</section>
  </div>`;

  document.getElementById("toggle").onclick = async () => {
    await q(sb.rpc("set_auto_approve", { on_off: !settings.auto_approve_checks }));
    renderAdmin();
  };
  document.getElementById("toggle-rev").onclick = async () => {
    await q(sb.rpc("set_early_reviews", { on_off: !settings.allow_early_reviews }));
    renderAdmin();
  };
  const decide = (approve) => async (e) => {
    e.target.disabled = true;
    try {
      await q(sb.rpc("review_verification", { vid: +(e.target.dataset.ok || e.target.dataset.no), approve }));
      toast(approve ? "Approved." : "Rejected. They'll be asked to try again.");
      renderAdmin();
    } catch { e.target.disabled = false; }
  };
  view().querySelectorAll("[data-ok]").forEach((b) => (b.onclick = decide(true)));
  view().querySelectorAll("[data-no]").forEach((b) => (b.onclick = decide(false)));
}
