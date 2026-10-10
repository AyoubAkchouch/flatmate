// Welcome screen and sign-up / log-in.
import { sb, view, go, esc, invite, friendlyError } from "../lib.js";
import { BRAND } from "../brand.js";

export function renderWelcome() {
  const invited = !!invite.get();
  view().innerHTML = `<div class="ob">
    ${invited ? `<div class="banner"><b>You've been invited to approve a sublet.</b> Create an account as the owner of the flat, or log in, to join the conversation.</div>` : ""}
    <h1>${esc(BRAND.headline)} <em>${esc(BRAND.headlineAccent)}</em></h1>
    <p class="lead">${esc(BRAND.pitch)}</p>
    <div class="ticket" aria-label="Example match">
      <div><small>LEAVING</small><b>LÉA</b><small>PARIS → MONTRÉAL</small></div><span class="perf"></span>
      <div><small>ARRIVING</small><b>DIEGO</b><small>BOGOTÁ → PARIS</small></div>
      <div class="foot">SAME FLAT · 6 JAN → 30 JUN 2027</div>
    </div>
    <ol class="how">
      <li><span><strong>Swipe</strong><span>Students and flats that fit your city and dates.</span></span></li>
      <li><span><strong>Chat with three</strong><span>The student leaving, the student arriving and the landlord.</span></span></li>
      <li><span><strong>Sign</strong><span>Pick a sublet contract and sign it in the app.</span></span></li>
    </ol>
    <div class="stack">
      <a class="btn primary full" href="#/auth/signup">Create an account</a>
      <a class="linkbtn" href="#/auth/login" style="text-align:center">I already have an account</a>
    </div>
  </div>`;
}

export function renderAuth(mode = "signup") {
  const signup = mode !== "login";
  view().innerHTML = `<div class="ob">
    <h2>${signup ? "Create your account" : "Welcome back"}</h2>
    <form class="form" id="authForm" novalidate>
      <label class="field"><span>Email</span><input id="a-email" type="email" autocomplete="email" required></label>
      <label class="field"><span>Password</span><input id="a-pass" type="password" autocomplete="${signup ? "new-password" : "current-password"}" minlength="6" required>
        ${signup ? "<small>At least 6 characters.</small>" : ""}</label>
      <p class="err" id="a-err" hidden></p>
      <button class="btn primary full" id="a-go">${signup ? "Create account" : "Log in"}</button>
    </form>
    <a class="linkbtn" href="#/auth/${signup ? "login" : "signup"}" style="text-align:center">${signup ? "I already have an account" : "Create a new account"}</a>
    <a class="linkbtn" href="#/welcome" style="text-align:center">Back</a>
  </div>`;
  const err = (m) => { const e = document.getElementById("a-err"); e.textContent = m; e.hidden = false; };
  document.getElementById("a-email").focus();
  document.getElementById("authForm").onsubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById("a-email").value.trim();
    const password = document.getElementById("a-pass").value;
    if (!/^\S+@\S+\.\S+$/.test(email)) return err("Enter a complete email address.");
    if (password.length < 6) return err("The password needs at least 6 characters.");
    const btn = document.getElementById("a-go");
    btn.disabled = true;
    btn.textContent = signup ? "Creating…" : "Logging in…";
    const { data, error } = signup
      ? await sb.auth.signUp({ email, password })
      : await sb.auth.signInWithPassword({ email, password });
    btn.disabled = false;
    btn.textContent = signup ? "Create account" : "Log in";
    if (error) {
      if (/Invalid login/i.test(error.message)) return err("That email and password don't match. Check them, or create an account.");
      if (/already registered/i.test(error.message)) return err("An account with this email already exists. Log in instead.");
      return err(friendlyError(error));
    }
    if (signup && !data.session) {
      view().innerHTML = `<div class="empty"><h3>Check your inbox</h3><p>We sent a confirmation link to <b>${esc(email)}</b>. Open it on this device to continue.</p></div>`;
      return;
    }
    // Signed in: main.js reacts to the new session and opens the right screen.
    go(signup ? "onboarding" : "discover");
  };
}
