// The app's entry point: decides which screen to show.
import { sb, state, configured, go, view, esc, invite, q, toast, loadProfile } from "./lib.js";
import { BRAND } from "./brand.js";
import { renderWelcome, renderAuth } from "./views/auth.js";
import { renderOnboarding } from "./views/onboarding.js";
import { renderDiscover } from "./views/discover.js";
import { renderListingForm } from "./views/listing.js";
import { renderChats, renderChat } from "./views/chat.js";
import { renderContracts, renderContract } from "./views/contract.js";
import { renderProfile } from "./views/profile.js";
import { renderAdmin } from "./views/admin.js";
import { renderInvite } from "./views/invite.js";

document.title = BRAND.fullName;
document.getElementById("brand").innerHTML = `${esc(BRAND.nameStart)}<span>${esc(BRAND.nameEnd)}</span>`;

const ROUTES = {
  welcome: renderWelcome,
  auth: renderAuth,
  onboarding: renderOnboarding,
  discover: renderDiscover,
  list: renderListingForm,
  chats: renderChats,
  chat: renderChat,
  contracts: renderContracts,
  contract: renderContract,
  profile: renderProfile,
  admin: renderAdmin,
  invite: renderInvite,
};
const PUBLIC = ["welcome", "auth"];
const TABS = { discover: "discover", list: "discover", chats: "chats", chat: "chats", contracts: "contracts", contract: "contracts", profile: "profile", admin: "profile" };

let routing = false, again = false;
async function route() {
  if (routing) { again = true; return; }
  routing = true;
  try { await doRoute(); }
  catch (e) { console.error(e); view().innerHTML = `<div class="empty"><h3>Something went wrong</h3><p>${esc(e.message || e)}</p><button class="btn" onclick="location.reload()">Reload</button></div>`; }
  finally {
    routing = false;
    if (again) { again = false; route(); }
  }
}

async function doRoute() {
  if (state.cleanup) { try { state.cleanup(); } catch { /* ignore */ } state.cleanup = null; }
  document.querySelectorAll(".overlay").forEach((o) => o.remove());

  if (!configured) {
    document.getElementById("tabs").hidden = true;
    view().innerHTML = `<div class="empty"><h3>Almost there</h3><p>Connect your Supabase project by filling in <b>js/config.js</b>. The setup guide in README.md explains how.</p></div>`;
    return;
  }

  const [name = "", arg] = location.hash.replace(/^#\/?/, "").split("/");

  // A landlord opened an invitation link: remember it until they're signed in.
  // Nothing is joined automatically: the landlord sees who is invited and confirms first.
  if (name === "invite" && arg) { invite.set(arg); return go(state.session ? "invite" : "welcome"); }

  if (!state.session) {
    document.getElementById("tabs").hidden = true;
    if (!PUBLIC.includes(name)) return go("welcome");
    return ROUTES[name](arg);
  }

  if (!state.profile) await loadProfile();

  if (!state.profile.onboarded) {
    if (name !== "onboarding") return go("onboarding");
  } else {
    if (invite.get() && name !== "invite") return go("invite");
    if (!invite.get() && name === "invite") return go("discover");
    if (PUBLIC.includes(name) || name === "onboarding" || !ROUTES[name]) return go("discover");
  }

  const tabs = document.getElementById("tabs");
  tabs.hidden = !TABS[name];
  tabs.querySelectorAll("a").forEach((a) => a.dataset.tab === TABS[name] ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current"));
  view().scrollTop = 0;
  await ROUTES[name](arg);
}

window.addEventListener("hashchange", route);

if (configured) {
  sb.auth.onAuthStateChange((event, session) => {
    const changedUser = (state.session?.user?.id || null) !== (session?.user?.id || null);
    state.session = session;
    if (changedUser) state.profile = null;
    // Re-route only when it matters (not on silent token refreshes).
    if (event === "INITIAL_SESSION" || changedUser) setTimeout(route, 0);
  });
} else {
  route();
}
