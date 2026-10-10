// Shared helpers used by every screen.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./config.js";

export const configured = !SUPABASE_URL.startsWith("PASTE") && !SUPABASE_ANON_KEY.startsWith("PASTE");

// ---------- Where the login is kept ----------
// By default a login only lives in the current browser tab and ends when the tab closes.
// "Keep me logged in on this device" stores it in the browser instead.
const REMEMBER = "fm-remember";
const safe = (fn, fallback = null) => { try { return fn(); } catch { return fallback; } };
export const rememberDevice = {
  get: () => safe(() => localStorage.getItem(REMEMBER) === "1", false),
  set: (on) => safe(() => (on ? localStorage.setItem(REMEMBER, "1") : localStorage.removeItem(REMEMBER))),
};
const authStorage = {
  getItem: (k) => safe(() => (rememberDevice.get() ? localStorage : sessionStorage).getItem(k)),
  setItem: (k, v) => safe(() => (rememberDevice.get() ? localStorage : sessionStorage).setItem(k, v)),
  removeItem: (k) => safe(() => { localStorage.removeItem(k); sessionStorage.removeItem(k); }),
};
// Remove logins saved by the earlier version of the app unless the person chose to stay logged in.
if (!rememberDevice.get()) safe(() => Object.keys(localStorage).filter((k) => k.startsWith("sb-")).forEach((k) => localStorage.removeItem(k)));

export const sb = configured
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { storage: authStorage, persistSession: true, detectSessionInUrl: true } })
  : null;

// Log out after 30 minutes without any activity, unless the person chose to stay logged in.
const IDLE_MS = 30 * 60 * 1000;
let lastActive = Date.now();
["pointerdown", "keydown", "scroll", "touchstart"].forEach((ev) => window.addEventListener(ev, () => { lastActive = Date.now(); }, { passive: true, capture: true }));
setInterval(async () => {
  if (!sb || rememberDevice.get() || !state.session) return;
  if (Date.now() - lastActive > IDLE_MS) { await sb.auth.signOut(); toast("You were logged out after 30 minutes without activity."); }
}, 60 * 1000);

// The signed-in person and their profile row.
export const state = { session: null, profile: null, cleanup: null };

export async function loadProfile() {
  if (!state.session) { state.profile = null; return null; }
  state.profile = await q(sb.from("profiles").select("*").eq("id", state.session.user.id).single());
  return state.profile;
}

export const view = () => document.getElementById("view");
export const go = (path) => { location.hash = "#/" + path; };

export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(String(iso).slice(0, 10) + "T12:00");
  return isNaN(d) ? String(iso) : d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
export const fmtShort = (iso) => {
  if (!iso) return "";
  const d = new Date(String(iso).slice(0, 10) + "T12:00");
  return isNaN(d) ? String(iso) : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

export function toast(msg, kind = "") {
  document.querySelectorAll(".toast").forEach((t) => t.remove());
  const t = document.createElement("div");
  t.className = "toast " + kind;
  t.setAttribute("role", "status");
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), kind === "err" ? 5000 : 2600);
}

// Run a Supabase request; show a readable error and stop if it fails.
export async function q(request) {
  const { data, error } = await request;
  if (error) {
    console.error(error);
    toast(friendlyError(error), "err");
    throw error;
  }
  return data;
}
// Supabase returns at most 1,000 rows per request: fetch page after page until everything is in.
// make() must return a fresh, ordered query each time.
export async function fetchAll(make, pageSize = 1000) {
  let out = [];
  for (let from = 0; ; from += pageSize) {
    const rows = await q(make().range(from, from + pageSize - 1));
    out = out.concat(rows);
    if (rows.length < pageSize) return out;
  }
}
export function friendlyError(error) {
  const m = error?.message || String(error);
  if (/rent_not_above_lease/.test(m)) return "The rent can't be higher than the rent on your own lease.";
  if (/Failed to fetch|NetworkError/i.test(m)) return "Can't reach the server. Check your connection and try again.";
  return m;
}

const PALETTE = ["#D2412E", "#2C57A8", "#1F8A5B", "#7A4FB5", "#C77D10", "#B5476E", "#147A86"];
export function initials(name) {
  return String(name || "?").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
}
export function avatar(name, seed = name, cls = "") {
  const s = String(seed || "");
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `<span class="avatar ${cls}" style="background:${PALETTE[h % PALETTE.length]}">${esc(initials(name))}</span>`;
}

export const photoUrl = (path) => sb.storage.from("listing-photos").getPublicUrl(path).data.publicUrl;

export function storageSafeName(file) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 5) || "jpg";
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
}

// ---------- Address → coordinates ----------
// French addresses use the national geocoder (IGN Géoplateforme); others fall back to OpenStreetMap.
export async function geocode(address, city) {
  const text = [address, city].filter(Boolean).join(", ");
  if (!text) return null;
  try {
    const r = await fetch(`https://data.geopf.fr/geocodage/search?q=${encodeURIComponent(text)}&limit=1`);
    if (r.ok) {
      const j = await r.json();
      const f = j.features && j.features[0];
      if (f && f.properties && f.properties.score > 0.5) {
        return { lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0], label: f.properties.label };
      }
    }
  } catch (e) { /* try the next service */ }
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(text)}`);
    if (r.ok) {
      const j = await r.json();
      if (j[0]) return { lat: +j[0].lat, lng: +j[0].lon, label: j[0].display_name };
    }
  } catch (e) { /* no result */ }
  return null;
}

// ---------- Travel time ----------
function km(a, b) {
  const r = (x) => (x * Math.PI) / 180;
  const dLa = r(b.lat - a.lat), dLo = r(b.lng - a.lng);
  const h = Math.sin(dLa / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLo / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}
// Estimate for public transport in a big city: about 3.4 minutes per km plus 7 minutes of walking and waiting.
export function travelTo(listing, place) {
  if (!place || place.lat == null || place.lng == null || listing.lat == null || listing.lng == null) return null;
  return { minutes: travelMinutes(km(listing, place)), uni: place.name };
}
export const travelMinutes = (distanceKm) => Math.round(7 + distanceKm * 3.4);
export const distanceKm = km;
// The student's own campus, from their profile.
export const hostPlace = (p) => (p && p.host_lat != null ? { lat: p.host_lat, lng: p.host_lng, name: p.host_university } : null);

// ---------- Demand ----------
// stats: { [listingId]: { views_7d, interested_7d } } from the listing_stats() database function.
// peers: active listings in the same city.
export function demandFor(listing, stats, peers) {
  const s = stats[listing.id] || { views_7d: 0, interested_7d: 0 };
  const same = peers.filter((p) => (p.city || "").trim().toLowerCase() === (listing.city || "").trim().toLowerCase());
  const pool = same.length ? same : [listing];
  const avgInterest = pool.reduce((a, p) => a + (stats[p.id]?.interested_7d || 0), 0) / pool.length;
  const perM2 = pool.map((p) => p.rent / p.size_m2).sort((a, b) => a - b);
  const medianPerM2 = perM2[Math.floor(perM2.length / 2)];
  let ratio, basis, level;
  if (avgInterest >= 2 && pool.length >= 3) {
    basis = "interest";
    ratio = s.interested_7d / avgInterest;
    level = ratio >= 1.4 ? "high" : ratio <= 0.6 ? "low" : "normal";
  } else {
    // Not enough activity yet: estimate from price. Cheaper than similar flats = more demand.
    basis = "price";
    ratio = medianPerM2 / (listing.rent / listing.size_m2);
    level = ratio >= 1.2 ? "high" : ratio <= 0.8 ? "low" : "normal";
  }
  return {
    views: s.views_7d, interested: s.interested_7d, ratio, level, basis, peers: pool.length,
    similarRent: Math.round((medianPerM2 * listing.size_m2) / 10) * 10,
  };
}

const round10 = (n) => Math.round(n / 10) * 10;
export function priceSuggestion(listing, d) {
  if (d.level === "high") {
    const s = Math.min(listing.lease_rent, round10(listing.rent * 1.08));
    return s > listing.rent
      ? { price: s, text: `More students want this flat than usual. You could ask €${s} and still match quickly.` }
      : { price: null, text: "More students want this flat than usual, but you already ask the rent on your lease. A sublet can't cost more than that." };
  }
  if (d.level === "low") {
    const s = round10(listing.rent * 0.9);
    return { price: s, text: `Fewer students than usual are interested. Asking €${s} should bring more matches. Seekers see it marked as a Hidden gem.` };
  }
  return { price: null, text: "Your price fits current demand. No change suggested." };
}

// ---------- Icons ----------
export const ICON = {
  star: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M12 3l2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3 6.4 20.2l1.1-6.2L3 9.6l6.2-.9z"/></svg>`,
  gem: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M6 4h12l3 5-9 11L3 9z"/><path d="M3 9h18M9 4l3 16 3-16"/></svg>`,
  train: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="6" y="3" width="12" height="13" rx="3"/><path d="M6 10h12M9 13h.01M15 13h.01M8 21l2-5M16 21l-2-5"/></svg>`,
  ok: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M8 12l3 3 5-6"/></svg>`,
  clock: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  na: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="12" r="9"/><path d="M8 12h8"/></svg>`,
  shield: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6z"/><path d="M9 12l2 2 4-4"/></svg>`,
  doc: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="11" r="2.5"/><path d="M6 16c1-2 5-2 6 0M14 10h4M14 13h4"/></svg>`,
  face: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M4 8V5h3M20 8V5h-3M4 16v3h3M20 16v3h-3"/><circle cx="12" cy="11" r="3.5"/><path d="M7 19c1-3 9-3 10 0"/></svg>`,
  plus: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M12 5v14M5 12h14"/></svg>`,
  x: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 6l12 12M18 6L6 18"/></svg>`,
  yes: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M3 11l9-7 9 7v9H3z"/><path d="M9 15l2 2 4-4"/></svg>`,
  photo: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-8 8"/></svg>`,
};

// A simple floor-plan drawing used when a flat has no photos yet.
export function floorPlan(kind, seed = "") {
  const variant = kind === "room" ? 1 : (String(seed).charCodeAt(String(seed).length - 1) || 0) % 2 === 0 ? 0 : 2;
  const t = (x, y, s) => `<text x="${x}" y="${y}" fill="var(--muted)" stroke="none" style="font:500 10px var(--mono);letter-spacing:.08em">${s}</text>`;
  const L = [
    `<rect x="20" y="20" width="260" height="160" rx="2"/><path d="M190 20v110M190 130h90M190 100h-30"/><path d="M60 180a28 28 0 0 1 28-28" stroke-dasharray="3 3"/>${t(60, 105, "LIVING / BED")}${t(205, 80, "BATH")}${t(205, 160, "KITCHEN")}`,
    `<rect x="20" y="20" width="260" height="160" rx="2"/><path d="M110 20v160M200 20v90M200 110h80M110 110h90"/>${t(35, 105, "YOUR ROOM")}${t(130, 70, "ROOM 2")}${t(215, 70, "ROOM 3")}${t(140, 150, "SHARED KITCHEN")}`,
    `<rect x="20" y="20" width="260" height="160" rx="2"/><path d="M150 20v160M150 110h130M220 110v70"/>${t(50, 105, "LIVING")}${t(185, 70, "BEDROOM")}${t(165, 150, "BATH")}${t(230, 150, "KITCH.")}`,
  ][variant];
  return `<svg class="fp" viewBox="0 0 300 200" fill="none" stroke="var(--ink)" stroke-width="2" aria-hidden="true">${L}</svg>`;
}

// A signature pad on a <canvas>. Returns { isEmpty(), toDataURL(), clear() }.
export function signaturePad(canvas) {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const g = canvas.getContext("2d");
  g.scale(dpr, dpr);
  g.lineWidth = 2.2;
  g.lineCap = "round";
  g.strokeStyle = "#16233F";
  let down = false, drawn = false;
  const pt = (e) => { const b = canvas.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  canvas.addEventListener("pointerdown", (e) => { down = true; canvas.dataset.touched = "1"; canvas.setPointerCapture(e.pointerId); g.beginPath(); g.moveTo(...pt(e)); });
  canvas.addEventListener("pointermove", (e) => { if (!down) return; g.lineTo(...pt(e)); g.stroke(); drawn = true; });
  const up = () => { down = false; };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);
  return {
    isEmpty: () => !drawn,
    clear: () => { g.clearRect(0, 0, canvas.width, canvas.height); drawn = false; },
    toDataURL: () => canvas.toDataURL("image/png"),
  };
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast("Link copied."); }
  catch { toast("Select the link and copy it by hand."); }
}

// Pending landlord invitation, kept while the landlord signs up.
export const invite = {
  get() { try { return sessionStorage.getItem("invite"); } catch { return null; } },
  set(t) { try { sessionStorage.setItem("invite", t); } catch { /* ignore */ } },
  clear() { try { sessionStorage.removeItem("invite"); } catch { /* ignore */ } },
};
