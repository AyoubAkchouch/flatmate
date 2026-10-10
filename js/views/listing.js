// Add or edit a flat to sublet. #/list = new flat, #/list/<id> = edit.
import { sb, state, view, go, esc, q, toast, ICON, geocode, photoUrl, storageSafeName } from "../lib.js";
import { UNIVERSITIES } from "../universities.js";

const TAGS = ["Furnished", "Bills included", "Washing machine", "Wi-Fi", "Balcony", "Near public transport", "Bike storage", "Quiet street"];

export async function renderListingForm(id) {
  const p = state.profile;
  let l = null;
  if (id) {
    l = await q(sb.from("listings").select("*").eq("id", id).single());
    if (l.owner_id !== p.id) return go("profile");
  }
  let kind = l?.kind || "whole";
  let newFiles = [];
  let keptPhotos = l?.photos ? [...l.photos] : [];
  const val = (k, fallback = "") => esc(l ? l[k] ?? "" : fallback);
  const uniOptions = [...new Set([p.home_university, ...UNIVERSITIES.map((u) => u.name)].filter(Boolean))];

  view().innerHTML = `<div class="ob">
    <a class="back" href="#/${l ? "profile" : "discover"}">‹ Cancel</a>
    <h2>${l ? "Edit your flat" : "Sublet your flat while you're away"}</h2>
    ${l ? "" : `<p class="lead">Students arriving in your city will see it in their swipe deck. We filled in what we already know from your profile.</p>`}
    <form class="form" id="lf" novalidate>
      <div class="tabs2" role="group" aria-label="What you're subletting">
        <button type="button" data-k="whole" aria-pressed="${kind === "whole"}">Whole flat</button>
        <button type="button" data-k="room" aria-pressed="${kind === "room"}">Room in a shared flat</button></div>
      <label class="field"><span>Listing title</span><input id="l-title" value="${val("title")}" placeholder="e.g. Quiet studio near campus" maxlength="80"></label>
      <div class="field"><span>Photos (up to 6)</span>
        <div class="thumbs" id="thumbs"></div>
        <label class="upload" for="l-photos" style="min-height:80px">${ICON.photo}<strong>Add photos</strong><small>The first photo is the one students see first</small>
          <input type="file" id="l-photos" accept="image/*" multiple></label></div>
      <label class="field"><span>Street address</span><input id="l-address" value="${val("address")}" placeholder="e.g. 12 rue Oberkampf"><small>Used to work out travel times. Students only see the neighbourhood.</small></label>
      <div class="two"><label class="field"><span>City</span><input id="l-city" value="${val("city", p.role === "subletter" ? p.city || "" : "")}"></label>
        <label class="field"><span>Neighbourhood</span><input id="l-area" value="${val("area")}" placeholder="e.g. 11e · Oberkampf"></label></div>
      <label class="field"><span>Nearest university ${l ? "" : `<span class="auto">From your profile</span>`}</span>
        <select id="l-uni">${uniOptions.map((u) => `<option ${(l ? l.near_university : p.home_university) === u ? "selected" : ""}>${esc(u)}</option>`).join("")}</select></label>
      <div class="two"><label class="field"><span>Free from ${l ? "" : `<span class="auto">Your exchange</span>`}</span><input id="l-from" type="date" value="${val("available_from", p.exchange_from || "")}"></label>
        <label class="field"><span>Until</span><input id="l-to" type="date" value="${val("available_to", p.exchange_to || "")}"></label></div>
      <div class="two"><label class="field"><span>Size (m²)</span><input id="l-size" type="number" min="5" inputmode="numeric" value="${val("size_m2")}" placeholder="20"></label>
        <label class="field"><span>Rent you ask (€/month)</span><input id="l-rent" type="number" min="1" inputmode="numeric" value="${val("rent")}" placeholder="650"></label></div>
      <label class="field"><span>Rent on your own lease (€/month)</span><input id="l-lease" type="number" min="1" inputmode="numeric" value="${val("lease_rent")}" placeholder="700">
        <small>A sublet can't cost more than the rent you pay, so price suggestions never go above this.</small></label>
      <div class="field"><span>What's included</span><div class="checkchips">${TAGS.map((t, i) =>
        `<label><input type="checkbox" id="l-tag${i}" value="${esc(t)}" ${l?.tags?.includes(t) ? "checked" : ""}>${esc(t)}</label>`).join("")}</div></div>
      <div class="two"><label class="field"><span>Landlord's name</span><input id="l-llname" value="${val("landlord_name")}" placeholder="e.g. M. Dubois"></label>
        <label class="field"><span>Landlord's email</span><input id="l-ll" type="email" value="${val("landlord_email")}" placeholder="Optional"></label></div>
      <small style="color:var(--muted);font-size:12px;margin-top:-6px">Your landlord is only contacted when you invite them from a chat.</small>
      <p class="err" id="lerr" hidden></p>
      <button class="btn red full" id="lsave">${l ? "Save changes" : "Publish listing"}</button>
      ${l ? `<button type="button" class="btn full" id="ltoggle">${l.active ? "Pause this listing" : "Show this listing again"}</button>` : ""}
    </form></div>`;

  const $ = (x) => document.getElementById(x);
  const drawThumbs = () => {
    $("thumbs").innerHTML = keptPhotos.map((path, i) => `<button type="button" class="linkbtn" style="padding:0;position:relative" data-rm="k${i}" aria-label="Remove photo"><img src="${esc(photoUrl(path))}" alt=""></button>`).join("")
      + newFiles.map((f, i) => `<button type="button" class="linkbtn" style="padding:0" data-rm="n${i}" aria-label="Remove photo"><img src="${URL.createObjectURL(f)}" alt=""></button>`).join("");
    $("thumbs").querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => {
      const [t, i] = [b.dataset.rm[0], +b.dataset.rm.slice(1)];
      t === "k" ? keptPhotos.splice(i, 1) : newFiles.splice(i, 1);
      drawThumbs();
    }));
  };
  drawThumbs();
  $("l-photos").onchange = (e) => { newFiles = newFiles.concat([...e.target.files]).slice(0, 6 - keptPhotos.length); e.target.value = ""; drawThumbs(); };
  view().querySelectorAll("[data-k]").forEach((b) => (b.onclick = () => {
    kind = b.dataset.k;
    view().querySelectorAll("[data-k]").forEach((x) => x.setAttribute("aria-pressed", x === b));
  }));
  if ($("ltoggle")) $("ltoggle").onclick = async () => {
    await q(sb.from("listings").update({ active: !l.active }).eq("id", l.id));
    toast(l.active ? "Listing paused. Students no longer see it." : "Listing visible again.");
    go("profile");
  };
  if (!l) $("l-title").focus();

  $("lf").onsubmit = async (e) => {
    e.preventDefault();
    const err = (m) => { $("lerr").textContent = m; $("lerr").hidden = false; $("lerr").scrollIntoView({ block: "center" }); };
    const data = {
      kind, title: $("l-title").value.trim(), address: $("l-address").value.trim(), city: $("l-city").value.trim(),
      area: $("l-area").value.trim(), near_university: $("l-uni").value, available_from: $("l-from").value || null,
      available_to: $("l-to").value || null, size_m2: +$("l-size").value, rent: +$("l-rent").value, lease_rent: +$("l-lease").value,
      tags: TAGS.filter((_, i) => $("l-tag" + i).checked), landlord_name: $("l-llname").value.trim() || null,
      landlord_email: $("l-ll").value.trim() || null,
    };
    if (!data.title || !data.city || !data.size_m2 || !data.rent || !data.lease_rent) return err("Add a title, the city, the size and both rents to publish.");
    if (data.available_from && data.available_to && data.available_to <= data.available_from) return err("The end date needs to be after the start date.");
    if (data.rent > data.lease_rent) return err(`You ask €${data.rent} but pay €${data.lease_rent} on your lease. A sublet can't cost more than your own rent, so lower the price to €${data.lease_rent} or less.`);

    const btn = $("lsave"); btn.disabled = true; btn.textContent = "Finding the address…";
    try {
      if (!l || data.address !== l.address || data.city !== l.city) {
        const g = await geocode(data.address, data.city);
        data.lat = g ? g.lat : null; data.lng = g ? g.lng : null;
        if (!g) toast("We couldn't place this address on a map, so travel times won't show.", "err");
      }
      btn.textContent = newFiles.length ? "Uploading photos…" : "Saving…";
      const uploaded = [];
      for (const f of newFiles) {
        const path = `${p.id}/${storageSafeName(f)}`;
        await q(sb.storage.from("listing-photos").upload(path, f, { contentType: f.type || undefined }));
        uploaded.push(path);
      }
      data.photos = keptPhotos.concat(uploaded);
      if (l) await q(sb.from("listings").update(data).eq("id", l.id));
      else await q(sb.from("listings").insert({ ...data, owner_id: p.id }));
      toast(l ? "Changes saved." : "Your flat is live. Here's how demand looks.");
      go("profile");
    } catch {
      btn.disabled = false; btn.textContent = l ? "Save changes" : "Publish listing";
    }
  };
}
