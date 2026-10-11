// Sign-up steps: role → details → identity check → student check → done.
import { sb, state, view, go, esc, q, toast, invite, ICON, loadProfile, storageSafeName, fmtDate } from "../lib.js";
import { searchHomeUniversities, searchDestinationSchools, autocomplete, campusPicker } from "../schools.js";

const ROLES = {
  seeker: { title: "I'm looking for a flat", d: "You're arriving somewhere on an exchange.", student: true,
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/></svg>` },
  subletter: { title: "I'm subletting my flat", d: "You're leaving on an exchange and your flat will be empty.", student: true,
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 11l9-7 9 7v9H3z"/><path d="M10 20v-5h4v5"/></svg>` },
  landlord: { title: "I own the flat", d: "Your tenant wants to sublet and needs your approval.", student: false,
    icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="8" cy="12" r="4"/><path d="M12 12h9M18 12v3M21 12v2"/></svg>` },
};
export const ROLE_LABEL = { seeker: "Looking for a flat", subletter: "Subletting a flat", landlord: "Landlord" };

const LABEL = { role: "Your role", details: "About you", identity: "Identity check", student: "Student status", ownflat: "Your own flat", done: "Ready" };
let ob = null; // the draft while onboarding

// checksOnly: a seeker who skipped the checks at sign-up and is doing them now, before their first yes.
const stepsFor = (role) => (ob?.checksOnly ? ["identity", "student", "done"]
  : ["role", "details", "identity"].concat(role === "landlord" ? [] : ["student"])
    .concat(role === "seeker" ? ["ownflat"] : []).concat(["done"]));
// Seekers can skip the checks until they say yes to a flat.
const canSkip = () => ob.role === "seeker" && !ob.checksOnly;
const skipLink = () => canSkip() ? `<button class="linkbtn" id="skip">Skip for now</button>
  <small class="skipnote">You can browse flats without it. It's needed before you say yes to one.</small>` : "";
const wireSkip = () => { const b = document.getElementById("skip"); if (b) b.onclick = next; };

function stepper() {
  const s = stepsFor(ob.role), i = s.indexOf(ob.step);
  return `<div class="steps"><span class="eyebrow">Step ${i + 1} of ${s.length} · ${LABEL[ob.step]}</span>
    <div class="bar">${s.map((_, j) => `<i class="${j <= i ? "on" : ""}"></i>`).join("")}</div></div>`;
}
function show(step) { ob.step = step; ob.err = ""; draw(); view().scrollTop = 0; }
function next() { const s = stepsFor(ob.role); show(s[s.indexOf(ob.step) + 1]); }
function prev() { const s = stepsFor(ob.role), i = s.indexOf(ob.step); if (i > 0) show(s[i - 1]); }

export function renderOnboarding() {
  const p = state.profile;
  let checksOnly = false;
  try { checksOnly = sessionStorage.getItem("fm-checks-only") === "1" && p.role === "seeker" && !!p.full_name; } catch { /* ignore */ }
  if (!ob || ob.userId !== p.id || (checksOnly && !ob.checksOnly)) {
    ob = { checksOnly,
      userId: p.id,
      step: checksOnly ? (["none", "failed"].includes(p.id_status) ? "identity" : "student")
        : !p.role ? "role" : !p.full_name ? "details"
        : ["none", "failed"].includes(p.id_status) ? "identity"
        : p.role !== "landlord" && ["none", "failed"].includes(p.student_status) ? "student"
        : p.role === "seeker" ? "ownflat" : "done",
      role: p.role || (invite.get() ? "landlord" : null),
      name: p.full_name || "", uni: p.home_university || "", uniRor: p.home_university_ror || null, homeCity: p.home_city || null,
      host: p.host_university ? { name: p.host_university, lat: p.host_lat, lng: p.host_lng } : null,
      campus: p.host_lat != null ? { name: p.host_campus || p.host_university, lat: p.host_lat, lng: p.host_lng } : null,
      city: p.city || "Paris", from: p.exchange_from || "", to: p.exchange_to || "", phone: p.phone || "",
      ownFlat: null, doc: "passport", docFile: null, selfie: null, cert: null, busy: false, err: "",
    };
  }
  draw();
}

function draw() {
  ({ role: stepRole, details: stepDetails, identity: stepIdentity, student: stepStudent, ownflat: stepOwnFlat, done: stepDone })[ob.step]();
}

function stepRole() {
  view().innerHTML = `<div class="ob">${stepper()}
    <h2>How will you use the app?</h2>
    <div class="roles" role="radiogroup">${Object.entries(ROLES).map(([k, r]) => `
      <label class="role"><input type="radio" name="role" value="${k}" ${ob.role === k ? "checked" : ""}>
        <span class="ic">${r.icon}</span>
        <span><strong>${r.title}</strong><span class="d">${r.d}</span>
          <span class="checks"><span class="pill wait">ID check</span>${r.student ? `<span class="pill wait">Student check</span>` : ""}</span></span>
      </label>`).join("")}</div>
    ${ob.err ? `<p class="err">${esc(ob.err)}</p>` : ""}
    <div class="stack"><button class="btn primary full" id="cont">Continue</button>
      <button class="linkbtn" id="logout">Log out</button></div></div>`;
  view().querySelectorAll('input[name="role"]').forEach((r) => (r.onchange = () => { ob.role = r.value; }));
  document.getElementById("cont").onclick = () => { if (!ob.role) { ob.err = "Choose one of the three roles to continue."; return draw(); } next(); };
  document.getElementById("logout").onclick = () => sb.auth.signOut();
}

function stepDetails() {
  const student = ob.role !== "landlord";
  const cityLabel = ob.role === "seeker" ? "City you're moving to" : ob.role === "subletter" ? "City of your flat" : "City of the property";
  view().innerHTML = `<div class="ob">${stepper()}
    <h2>${student ? "Tell us about your exchange" : "Tell us about you"}</h2>
    <form class="form" id="f" novalidate>
      <label class="field"><span>Full name, as on your ID</span><input id="d-name" value="${esc(ob.name)}" autocomplete="name"></label>
      ${student ? `<div class="field"><span>Home university</span><input id="d-uni" value="${esc(ob.uni)}" placeholder="Start typing, e.g. University of Lagos">
          <small>From the worldwide Research Organization Registry.</small></div>`
        : `<label class="field"><span>Phone</span><input id="d-phone" value="${esc(ob.phone)}" autocomplete="tel"></label>`}
      <label class="field"><span>${cityLabel}</span><input id="d-city" value="${esc(ob.city)}"></label>
      ${ob.role === "seeker" ? `<div class="field"><span>School you're going to</span>
          <input id="d-host" value="${esc(ob.host?.name || "")}" placeholder="Start typing, e.g. Universidad Complutense">
          <small>Recognised French schools and universities worldwide.</small></div>
        <div id="campus"></div>` : ""}
      ${student ? `<div class="two"><label class="field"><span>${ob.role === "seeker" ? "Arriving" : "Leaving"}</span><input id="d-from" type="date" value="${esc(ob.from)}"></label>
        <label class="field"><span>${ob.role === "seeker" ? "Leaving" : "Back"}</span><input id="d-to" type="date" value="${esc(ob.to)}"></label></div>` : ""}
      ${ob.err ? `<p class="err">${esc(ob.err)}</p>` : ""}
      <button class="btn primary full" id="save">Continue to identity check</button>
    </form><button class="linkbtn" id="back">Back</button></div>`;

  if (student) autocomplete(document.getElementById("d-uni"), searchHomeUniversities, (it) => {
    ob.uniRor = it ? it.ror : null;
    if (it) { ob.uni = it.name; ob.homeCity = (it.detail || "").split(",")[0].trim() || null; }
  });

  // Campus: a list of the chosen school's campuses, or any other address.
  const drawCampus = () => {
    const box = document.getElementById("campus");
    if (box) campusPicker(box, ob.host, ob.campus, (place) => { ob.campus = place; });
  };
  if (ob.role === "seeker") {
    autocomplete(document.getElementById("d-host"), searchDestinationSchools, (it) => { ob.host = it; ob.campus = null; drawCampus(); },
      (i) => `<strong>${esc(i.name)}</strong><span>${esc(i.detail || "")}</span>`);
    drawCampus();
  }

  const v = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ""; };
  document.getElementById("f").onsubmit = async (e) => {
    e.preventDefault();
    ob.name = v("d-name"); ob.city = v("d-city");
    if (student) { ob.uni = v("d-uni"); ob.from = v("d-from"); ob.to = v("d-to"); } else ob.phone = v("d-phone");
    if (!ob.name || !ob.city || (student && (!ob.uni || !ob.from || !ob.to))) { ob.err = "Fill in every field to continue."; return draw(); }
    if (student && ob.to <= ob.from) { ob.err = "The end date needs to be after the start date."; return draw(); }
    let place = null;
    if (ob.role === "seeker") {
      if (!ob.host) { ob.err = "Choose the school you're going to from the suggestions."; return draw(); }
      place = ob.campus;
      if (!place) { ob.err = "Choose your campus, or type its address and pick it from the suggestions."; return draw(); }
    }
    const btn = document.getElementById("save"); btn.disabled = true; btn.textContent = "Saving…";
    try {
      await q(sb.from("profiles").update({
        role: ob.role, full_name: ob.name, city: ob.city, phone: student ? null : ob.phone,
        home_university: student ? ob.uni : null, home_university_ror: student ? ob.uniRor : null,
        home_city: student ? (ob.homeCity || null) : null,
        host_university: ob.role === "seeker" ? ob.host.name : null,
        host_campus: place && place.name ? place.name : null,
        host_lat: place ? place.lat : null, host_lng: place ? place.lng : null,
        exchange_from: student ? ob.from : null, exchange_to: student ? ob.to : null,
      }).eq("id", ob.userId));
      if (!student) await q(sb.rpc("skip_student_check"));
      await loadProfile();
      next();
    } catch { btn.disabled = false; btn.textContent = "Continue to identity check"; }
  };
  document.getElementById("back").onclick = prev;
}

async function upload(file, kind) {
  const path = `${ob.userId}/${kind}-${storageSafeName(file)}`;
  await q(sb.storage.from("verification").upload(path, file, { contentType: file.type || undefined }));
  return path;
}

// Animated checklist while a check runs.
function progress(rows, activeIndex) {
  return `<div class="progress" aria-live="polite">${rows.map((t, i) =>
    `<div class="${i < activeIndex ? "ok" : i === activeIndex ? "on" : ""}"><span class="dot"></span>${t}</div>`).join("")}</div>`;
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function stepIdentity() {
  const p = state.profile;
  const box = (key, icon, label, hint) => `<label class="upload ${ob[key] ? "has" : ""}" for="up-${key}">${ob[key] ? ICON.ok : icon}
    <strong>${label}</strong><small>${ob[key] ? esc(ob[key].name) : hint}</small>
    <input type="file" accept="image/*" ${key === "selfie" ? 'capture="user"' : ""} id="up-${key}" data-key="${key}"></label>`;
  view().innerHTML = `<div class="ob">${stepper()}
    <h2>Check your identity</h2>
    <p class="lead">${ob.checksOnly ? "Before you say yes to a flat, students subletting want to know you're real. This takes about a minute." : "Everyone is verified, so you know the person behind each flat and each request is real."}</p>
    <div class="provider">${ICON.shield}<span>Your photos are stored privately and only seen by the review team.</span></div>
    <label class="field"><span>Document type</span><select id="doc">${[["passport", "Passport"], ["id_card", "National ID card"], ["residence_permit", "Residence permit"]]
      .map(([v, t]) => `<option value="${v}" ${ob.doc === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>
    <div class="uploads">${box("docFile", ICON.doc, "Photo of your document", "Photo page, all corners visible")}${box("selfie", ICON.face, "Selfie", "Face the camera, no glasses")}</div>
    <div id="prog"></div>
    ${ob.err ? `<p class="err">${esc(ob.err)}</p>` : ""}
    <div class="stack"><button class="btn primary full" id="check">Start the check</button>
      ${skipLink()}${ob.checksOnly ? `<button class="linkbtn" id="later">Not now, back to flats</button>` : `<button class="linkbtn" id="back">Back</button>`}</div></div>`;
  wireSkip(); wireLater();
  document.getElementById("doc").onchange = (e) => (ob.doc = e.target.value);
  view().querySelectorAll(".upload input").forEach((i) => (i.onchange = () => { if (i.files[0]) { ob[i.dataset.key] = i.files[0]; ob.err = ""; draw(); } }));
  const bk = document.getElementById("back"); if (bk) bk.onclick = prev;
  document.getElementById("check").onclick = async () => {
    if (!ob.docFile || !ob.selfie) { ob.err = "Add both photos before starting the check."; return draw(); }
    const btn = document.getElementById("check"); btn.disabled = true; btn.textContent = "Checking…";
    const rows = ["Uploading your photos", "Reading the document", "Matching your face to the photo"];
    const prog = document.getElementById("prog");
    try {
      prog.innerHTML = progress(rows, 0);
      const files = [await upload(ob.docFile, "id-document"), await upload(ob.selfie, "id-selfie")];
      prog.innerHTML = progress(rows, 1);
      const status = await q(sb.rpc("submit_verification", { check_kind: "identity", doc_type: ob.doc, file_paths: files }));
      await wait(700); prog.innerHTML = progress(rows, 2); await wait(700); prog.innerHTML = progress(rows, 3);
      await loadProfile();
      toast(status === "verified" ? "Identity verified." : "Sent for review. You can keep going.");
      await wait(500); next();
    } catch { btn.disabled = false; btn.textContent = "Try again"; }
  };
}

function stepStudent() {
  view().innerHTML = `<div class="ob">${stepper()}
    <h2>Confirm you're a student</h2>
    <p class="lead">The app is only for students on exchange, so ${ob.role === "seeker" ? "people subletting know who's moving in" : "students looking for a flat know you're one of them"}.</p>
    <label class="upload ${ob.cert ? "has" : ""}" for="cert">${ob.cert ? ICON.ok : ICON.doc}<strong>Enrolment or exchange certificate</strong>
      <small>${ob.cert ? esc(ob.cert.name) : "PDF or photo, dated this academic year"}</small>
      <input type="file" id="cert" accept="image/*,application/pdf"></label>
    <div id="prog"></div>
    ${ob.err ? `<p class="err">${esc(ob.err)}</p>` : ""}
    <div class="stack"><button class="btn primary full" id="submit">Submit certificate</button>
      ${skipLink()}${ob.checksOnly ? `<button class="linkbtn" id="later">Not now, back to flats</button>` : ""}<button class="linkbtn" id="back">Back</button></div></div>`;
  document.getElementById("cert").onchange = (e) => { if (e.target.files[0]) { ob.cert = e.target.files[0]; ob.err = ""; draw(); } };
  document.getElementById("back").onclick = prev;
  wireSkip(); wireLater();
  document.getElementById("submit").onclick = async () => {
    if (!ob.cert) { ob.err = "Add your certificate before submitting."; return draw(); }
    const btn = document.getElementById("submit"); btn.disabled = true; btn.textContent = "Sending…";
    const prog = document.getElementById("prog"), rows = ["Uploading your certificate", "Checking it"];
    try {
      prog.innerHTML = progress(rows, 0);
      const path = await upload(ob.cert, "student-certificate");
      prog.innerHTML = progress(rows, 1);
      const status = await q(sb.rpc("submit_verification", { check_kind: "student", doc_type: "certificate", file_paths: [path] }));
      await wait(700); prog.innerHTML = progress(rows, 2);
      await loadProfile();
      toast(status === "verified" ? "Student status verified." : "Sent for review. You can keep going.");
      await wait(500); next();
    } catch { btn.disabled = false; btn.textContent = "Try again"; }
  };
}

// Seekers often leave a flat behind at home: offer to sublet it too.
function stepOwnFlat() {
  const home = ob.homeCity || state.profile.home_city;
  view().innerHTML = `<div class="ob">${stepper()}
    <h2>Will your own flat be empty while you're away?</h2>
    <p class="lead">Many exchange students sublet their room or flat back home${home ? ` in ${esc(home)}` : ""} to a student coming the other way. It pays your rent while you're abroad.</p>
    <div class="roles" role="radiogroup">
      <label class="role"><input type="radio" name="own" value="yes" ${ob.ownFlat === true ? "checked" : ""}>
        <span class="ic">${ROLES.subletter.icon}</span>
        <span><strong>Yes, I'd like to sublet it</strong><span class="d">You'll list it right after this. You can switch between looking for a flat and managing yours from your profile.</span></span></label>
      <label class="role"><input type="radio" name="own" value="no" ${ob.ownFlat === false ? "checked" : ""}>
        <span class="ic">${ROLES.seeker.icon}</span>
        <span><strong>Not now</strong><span class="d">You can list a flat later with the + button.</span></span></label>
    </div>
    ${ob.err ? `<p class="err">${esc(ob.err)}</p>` : ""}
    <div class="stack"><button class="btn primary full" id="cont">Continue</button><button class="linkbtn" id="back">Back</button></div></div>`;
  view().querySelectorAll('input[name="own"]').forEach((r) => (r.onchange = () => { ob.ownFlat = r.value === "yes"; }));
  document.getElementById("cont").onclick = () => { if (ob.ownFlat == null) { ob.err = "Choose one of the two options."; return draw(); } next(); };
  document.getElementById("back").onclick = prev;
}

// Leave the checks for later and go back to the flats.
function wireLater() {
  const b = document.getElementById("later");
  if (b) b.onclick = finish;
}
async function finish() {
  const p = state.profile;
  try { sessionStorage.removeItem("fm-checks-only"); } catch { /* ignore */ }
  await q(sb.from("profiles").update({ onboarded: true }).eq("id", p.id));
  await loadProfile();
  const listFirst = !ob.checksOnly && (p.role === "subletter" || (p.role === "seeker" && ob.ownFlat));
  ob = null;
  go(listFirst ? "list" : "discover");
}

function badge(status, title, okText) {
  if (status === "verified") return `<div class="vbadge">${ICON.ok}<span><strong>${title} verified</strong><span>${okText}</span></span></div>`;
  if (status === "pending") return `<div class="vbadge wait">${ICON.clock}<span><strong>${title} being reviewed</strong><span>You can use the app meanwhile. Your profile shows "pending".</span></span></div>`;
  if (status === "failed") return `<div class="vbadge na">${ICON.na}<span><strong>${title} not accepted</strong><span>Try again from your profile.</span></span></div>`;
  if (status === "none" && state.profile.role === "seeker") return `<div class="vbadge wait">${ICON.clock}<span><strong>${title}: later</strong><span>You can browse flats now. It's needed before you say yes to one.</span></span></div>`;
  return `<div class="vbadge na">${ICON.na}<span><strong>${title} not needed</strong><span>Landlords only verify their identity.</span></span></div>`;
}

function stepDone() {
  const p = state.profile;
  view().innerHTML = `<div class="ob">${stepper()}
    <h2>${ob.checksOnly ? "Thanks" : "You're all set"}, ${esc((p.full_name || "").split(" ")[0])}</h2>
    ${ob.checksOnly ? `<p class="lead">You can now say yes to flats.</p>` : ""}
    <div class="idcard">${avatarFor(p)}<span><b>${esc(p.full_name)}</b><br><span style="color:var(--muted);font-size:13px">${ROLE_LABEL[p.role]} · ${esc(p.city || "")}</span>
      ${p.exchange_from ? `<br><span style="color:var(--muted);font-size:13px">${fmtDate(p.exchange_from)} → ${fmtDate(p.exchange_to)}</span>` : ""}</span></div>
    <div class="stack">
      ${badge(p.id_status, "Identity", "Shown on your profile to everyone you match with")}
      ${badge(p.student_status, "Student status", esc(p.home_university || ""))}
    </div>
    <button class="btn primary full" id="enter">${ob.checksOnly ? "Back to the flats" : p.role === "seeker" ? (ob.ownFlat ? "List my flat" : "Start looking for flats") : p.role === "subletter" ? "List my flat" : invite.get() ? "Open the chat" : "Go to my sublet requests"}</button></div>`;
  document.getElementById("enter").onclick = finish;
}

function avatarFor(p) {
  return `<span class="avatar" style="background:var(--accent)">${esc((p.full_name || "?").split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase())}</span>`;
}
