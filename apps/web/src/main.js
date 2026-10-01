import { createClient } from "matrix-js-sdk";
import { decodeRecoveryKey } from "matrix-js-sdk/lib/crypto-api/recovery-key.js";
import "./styles.css";
import { esc, formatBytes, isOfflineError } from "./utils.js";
import { SUPPORTED_LANGUAGES, getLang, setLang, translate } from "./i18n.js";

const app = document.querySelector("#app");
const KEY = "relay.matrix.session.v1";
const OUTBOX_KEY = "relay.outbox.v1";
const DATA_SAVER_KEY = "relay.dataSaver.v1";
const home = import.meta.env.VITE_MATRIX_HOMESERVER_URL || "http://localhost:8008";
const IDENTITY_URL = import.meta.env.VITE_RELAY_IDENTITY_URL || "http://localhost:9001";
const MODERATION_URL = import.meta.env.VITE_RELAY_MODERATION_URL || "http://localhost:9002";
let mx, roomId, mediaRecorder, recordedChunks = [];
let lang = getLang();
const t = (key, vars) => translate(lang, key, vars);

const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
const save = s => localStorage.setItem(KEY, JSON.stringify(s));
const clear = () => localStorage.removeItem(KEY);

// --- Low-data mode ---------------------------------------------------------
// Africa-first networks are frequently slow and metered. By default, images,
// voice notes and files render as a "tap to load" placeholder instead of
// downloading automatically (thumbnail-first / download-on-demand, per
// docs/ARCHITECTURE.md's low-data architecture section). Revealed media is
// intentionally *not* persisted across reloads so re-opening the app doesn't
// silently re-spend data.
const revealedMedia = new Set();
const loadDataSaver = () => { try { const v = localStorage.getItem(DATA_SAVER_KEY); return v === null ? true : v === "1"; } catch { return true; } };
const saveDataSaver = on => { try { localStorage.setItem(DATA_SAVER_KEY, on ? "1" : "0"); } catch {} };
let dataSaver = loadDataSaver();

// --- Language selection -----------------------------------------------------
function languageOptions(selected) {
  return SUPPORTED_LANGUAGES.map(l => `<option value="${esc(l.code)}" ${l.code===selected?"selected":""}>${esc(l.label)}</option>`).join("");
}
function bindLanguageSelect(render) {
  const select = document.querySelector("#langSelect");
  if (!select) return;
  select.onchange = e => { lang = e.target.value; setLang(lang); render(); };
}

// --- Offline outbox -------------------------------------------------------
// Text messages that fail to send because the device is offline are kept
// here (not just in the Matrix SDK's in-memory retry queue) so they survive
// a page reload and are replayed once connectivity returns.
const loadOutbox = () => { try { return JSON.parse(localStorage.getItem(OUTBOX_KEY)) || []; } catch { return []; } };
const saveOutbox = items => localStorage.setItem(OUTBOX_KEY, JSON.stringify(items));

function queueOutboxMessage(targetRoomId, body) {
  const items = loadOutbox();
  items.push({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, roomId: targetRoomId, body, queuedAt: Date.now() });
  saveOutbox(items);
}

async function flushOutbox() {
  if (!mx || !navigator.onLine) return;
  const items = loadOutbox();
  if (!items.length) return;
  const remaining = [];
  for (const item of items) {
    try { await mx.sendTextMessage(item.roomId, item.body); }
    catch { remaining.push(item); }
  }
  saveOutbox(remaining);
  render();
}

window.addEventListener("online", flushOutbox);

function login(error="") {
  app.innerHTML = `<main class="auth"><section class="card">
    <div class="langbar"><select id="langSelect">${languageOptions(lang)}</select></div>
    <div class="brand">R</div><p class="eyebrow">${esc(t("tagline"))}</p>
    <h1>${esc(t("heroLogin"))}</h1>
    <p class="muted">${esc(t("heroSub"))}</p>
    <form id="login"><label>${esc(t("homeserver"))}<input id="hs" type="url" value="${esc(home)}" required></label>
    <label>${esc(t("matrixId"))}<input id="uid" placeholder="@ama:example.org" required></label>
    <label>${esc(t("password"))}<input id="pw" type="password" required></label>
    <button>${esc(t("signIn"))}</button><p class="error ${error?"":"hidden"}">${esc(error)}</p></form>
    <p class="muted">${esc(t("newToRelayQuestion"))} <a href="#" id="toRegister">${esc(t("newToRelayAction"))}</a></p>
    <small>Development milestone: token persistence still requires production hardening.</small>
  </section></main>`;
  bindLanguageSelect(() => login(error));
  document.querySelector("#login").onsubmit = async e => {
    e.preventDefault();
    try {
      const baseUrl = document.querySelector("#hs").value.replace(/\/+$/,"");
      const auth = createClient({baseUrl});
      const r = await auth.loginWithPassword(document.querySelector("#uid").value.trim(), document.querySelector("#pw").value);
      const session = {baseUrl, accessToken:r.access_token, userId:r.user_id, deviceId:r.device_id};
      save(session); await start(session);
    } catch (err) { login(err?.message || "Login failed"); }
  };
  document.querySelector("#toRegister").onclick = e => { e.preventDefault(); register(); };
}

// --- Registration ----------------------------------------------------------
// Creates a new Matrix account on the configured homeserver, then claims a
// stable public @handle through the Relay identity service. The handle is
// independent of the Matrix localpart so it can be migrated later without
// breaking how other people find this person.
let usernameCheckTimer;
function register(error="") {
  app.innerHTML = `<main class="auth"><section class="card">
    <div class="langbar"><select id="langSelect">${languageOptions(lang)}</select></div>
    <div class="brand">R</div><p class="eyebrow">${esc(t("tagline"))}</p>
    <h1>${esc(t("heroRegister"))}</h1>
    <p class="muted">${esc(t("heroRegisterSub"))}</p>
    <form id="register"><label>${esc(t("homeserver"))}<input id="hs" type="url" value="${esc(home)}" required></label>
    <label>${esc(t("stableHandle"))}<input id="handle" placeholder="ama" pattern="[a-z][a-z0-9_]{2,31}" required>
      <small id="handleStatus" class="muted"></small></label>
    <label>${esc(t("password"))}<input id="pw" type="password" minlength="8" required></label>
    <label>${esc(t("confirmPassword"))}<input id="pw2" type="password" minlength="8" required></label>
    <button>${esc(t("createAccount"))}</button><p class="error ${error?"":"hidden"}">${esc(error)}</p></form>
    <p class="muted">${esc(t("alreadyHaveAccountQuestion"))} <a href="#" id="toLogin">${esc(t("alreadyHaveAccountAction"))}</a></p>
  </section></main>`;
  bindLanguageSelect(() => register(error));

  document.querySelector("#handle").oninput = e => {
    const status = document.querySelector("#handleStatus");
    const value = e.target.value.trim().toLowerCase();
    clearTimeout(usernameCheckTimer);
    if (!value) { status.textContent = ""; return; }
    status.textContent = "Checking availability…";
    usernameCheckTimer = setTimeout(async () => {
      try {
        const r = await fetch(`${IDENTITY_URL}/usernames/check`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: value }) });
        const data = await r.json();
        status.textContent = data.available ? "@" + value + " is available" : "Not available";
        status.style.color = data.available ? "#67e7a7" : "#ffd1cc";
      } catch { status.textContent = "Could not reach identity service"; }
    }, 350);
  };

  document.querySelector("#toLogin").onclick = e => { e.preventDefault(); login(); };
  document.querySelector("#register").onsubmit = async e => {
    e.preventDefault();
    const handle = document.querySelector("#handle").value.trim().toLowerCase();
    const pw = document.querySelector("#pw").value;
    const pw2 = document.querySelector("#pw2").value;
    if (pw !== pw2) return register("Passwords do not match.");
    try {
      const baseUrl = document.querySelector("#hs").value.replace(/\/+$/,"");
      const avail = await fetch(`${IDENTITY_URL}/usernames/check`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: handle }) }).then(r => r.json());
      if (!avail.available) return register(`@${handle} is not available.`);

      const auth = createClient({ baseUrl });
      const r = await auth.register(handle, pw, undefined, { type: "m.login.dummy" });
      const session = { baseUrl, accessToken: r.access_token, userId: r.user_id, deviceId: r.device_id };

      await fetch(`${IDENTITY_URL}/usernames/register`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: handle, matrixUserId: r.user_id }),
      });

      save(session); await start(session);
    } catch (err) { register(err?.data?.error || err?.message || "Registration failed"); }
  };
}

async function start(s) {
  app.innerHTML = `<main class="loading">Opening encrypted session…</main>`;
  mx = createClient({baseUrl:s.baseUrl, accessToken:s.accessToken, userId:s.userId, deviceId:s.deviceId, cryptoCallbacks: makeCryptoCallbacks()});
  await mx.initRustCrypto();
  mx.on("sync", state => { if (state === "PREPARED") { render(); flushOutbox(); attemptSilentRecoveryUnlock(); } });
  mx.on("Room.timeline", (evt,r) => {
    if (!roomId || r?.roomId === roomId) render();
    notifyIncoming(evt, r);
  });
  mx.startClient({initialSyncLimit:50});
  shell();
  requestNotificationPermission();
}

function requestNotificationPermission() {
  if (typeof Notification === "undefined" || Notification.permission !== "default") return;
  // Best-effort foreground notifications only: there is no push server
  // behind this web client yet, so this only fires while the tab/browser
  // process is open. See docs/KNOWN_LIMITATIONS.md.
  Notification.requestPermission().catch(() => {});
}

function notifyIncoming(evt, room) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
  if (!document.hidden) return;
  if (evt.getType() !== "m.room.message" || evt.getSender() === mx?.getUserId()) return;
  const body = evt.getContent()?.body;
  if (!body) return;
  try { new Notification(room?.name || evt.getSender(), { body, tag: room?.roomId }); } catch {}
}

function shell() {
  app.innerHTML = `<div class="shell"><aside>
    <header><div class="brand small">R</div><div><p class="eyebrow">Relay</p><strong>${esc(mx.getUserId())}</strong></div></header>
    <select id="langSelect" class="lang-select">${languageOptions(lang)}</select>
    <button id="new">${esc(t("newChat"))}</button><button id="newGroup" class="secondary">${esc(t("newGroup"))}</button>
    <button id="dataSaverToggle" class="secondary" title="${esc(t("dataSaverHint"))}">${esc(t(dataSaver ? "dataSaverOn" : "dataSaverOff"))}</button>
    <button id="security" class="secondary">${esc(t("security"))}</button>
    <div id="offlineBanner" class="offline hidden">${esc(t("offlineBanner"))}</div>
    <div id="rooms"></div><button id="logout" class="secondary">${esc(t("logOut"))}</button>
  </aside><main class="chat"><header id="head"></header><section id="timeline"></section>
    <form id="send" class="send hidden">
      <input id="file" type="file" class="hidden">
      <button type="button" id="attach" class="secondary icon" title="Attach file">📎</button>
      <button type="button" id="mic" class="secondary icon" title="Record voice note">🎙️</button>
      <textarea id="msg" rows="1" placeholder="${esc(t("writeMessage"))}"></textarea><button>${esc(t("send"))}</button>
    </form>
  </main></div><dialog id="dialog"><form id="create"><h2 id="createTitle">New encrypted chat</h2>
    <label>Matrix ID<input id="invitee" placeholder="@kwame:example.org" required></label>
    <label id="groupNameField" class="hidden">Group name<input id="groupName" placeholder="Market traders"></label>
    <p id="createError" class="error hidden"></p><div class="actions"><button type="button" id="cancel" class="secondary">Cancel</button><button>Create</button></div>
  </form></dialog>
  <dialog id="reportDialog"><form id="reportForm"><h2>Report content</h2>
    <label>Reason<select id="reasonCode">
      <option value="spam">Spam</option><option value="harassment">Harassment</option>
      <option value="impersonation">Impersonation</option><option value="scam_fraud">Scam or fraud</option>
      <option value="hate_speech">Hate speech</option><option value="violence">Violence</option>
      <option value="self_harm">Self-harm</option><option value="illegal_goods">Illegal goods</option>
      <option value="other">Other</option></select></label>
    <label>Additional context<textarea id="reportContext" rows="3" placeholder="Optional details"></textarea></label>
    <p id="reportError" class="error hidden"></p><div class="actions"><button type="button" id="reportCancel" class="secondary">Cancel</button><button>Submit report</button></div>
  </form></dialog>
  <dialog id="securityDialog"><h2>Security &amp; recovery</h2>
    <p id="securityStatus" class="muted">Checking recovery key status…</p>
    <p class="muted small">A recovery key lets you restore your encrypted message history if you sign in on a new device. Keep it somewhere safe — Relay cannot recover it for you.</p>
    <div class="actions"><button type="button" id="securityClose" class="secondary">Close</button>
      <button type="button" id="unlockRecovery" class="secondary">Unlock with recovery key</button>
      <button type="button" id="setupRecovery">Set up recovery key</button></div>
  </dialog>
  <dialog id="recoveryPasswordDialog"><form id="recoveryPasswordForm"><h2>Confirm your password</h2>
    <p class="muted small">Setting up a recovery key re-signs your device, which requires your account password.</p>
    <label>Password<input id="recoveryPassword" type="password" required></label>
    <p id="recoveryPasswordError" class="error hidden"></p>
    <div class="actions"><button type="button" id="recoveryPasswordCancel" class="secondary">Cancel</button><button>Continue</button></div>
  </form></dialog>
  <dialog id="recoveryKeyDialog"><h2>Save your recovery key</h2>
    <p class="muted small">Store this somewhere safe (password manager, written down). Anyone who loses access to all signed-in devices will need it to read old messages.</p>
    <code id="recoveryKeyValue" class="recovery-key"></code>
    <div class="actions"><button type="button" id="recoveryKeyCopy" class="secondary">Copy</button><button type="button" id="recoveryKeyDone">I've saved it</button></div>
  </dialog>
  <dialog id="recoveryEntryDialog"><form id="recoveryEntryForm"><h2>Enter recovery key</h2>
    <p class="muted small">Enter the recovery key you saved when you set up this account to unlock encrypted history on this device.</p>
    <label>Recovery key<input id="recoveryEntryValue" placeholder="EsT 1abc 2def ..." required></label>
    <p id="recoveryEntryError" class="error hidden"></p>
    <div class="actions"><button type="button" id="recoveryEntryCancel" class="secondary">Skip</button><button>Unlock</button></div>
  </form></dialog>`;
  document.querySelector("#new").onclick = () => openCreateDialog(false);
  document.querySelector("#newGroup").onclick = () => openCreateDialog(true);
  document.querySelector("#cancel").onclick = () => document.querySelector("#dialog").close();
  document.querySelector("#logout").onclick = logout;
  document.querySelector("#create").onsubmit = createRoom;
  document.querySelector("#send").onsubmit = send;
  document.querySelector("#attach").onclick = () => document.querySelector("#file").click();
  document.querySelector("#file").onchange = sendAttachment;
  document.querySelector("#mic").onclick = toggleVoiceRecording;
  document.querySelector("#reportCancel").onclick = () => document.querySelector("#reportDialog").close();
  document.querySelector("#reportForm").onsubmit = submitReport;
  document.querySelector("#dataSaverToggle").onclick = toggleDataSaver;
  document.querySelector("#security").onclick = openSecurityDialog;
  document.querySelector("#securityClose").onclick = () => document.querySelector("#securityDialog").close();
  document.querySelector("#setupRecovery").onclick = () => openRecoveryPasswordDialog();
  document.querySelector("#unlockRecovery").onclick = () => attemptRecoveryUnlock(true);
  document.querySelector("#recoveryPasswordCancel").onclick = () => document.querySelector("#recoveryPasswordDialog").close();
  document.querySelector("#recoveryPasswordForm").onsubmit = submitRecoveryPassword;
  document.querySelector("#recoveryKeyCopy").onclick = copyRecoveryKey;
  document.querySelector("#recoveryKeyDone").onclick = () => document.querySelector("#recoveryKeyDialog").close();
  document.querySelector("#recoveryEntryForm").onsubmit = submitRecoveryEntry;
  document.querySelector("#recoveryEntryCancel").onclick = () => { document.querySelector("#recoveryEntryDialog").close(); resolveRecoveryPrompt(null); };
  document.querySelector("#recoveryEntryDialog").addEventListener("cancel", () => resolveRecoveryPrompt(null));
  bindLanguageSelect(shell);
  window.addEventListener("online", updateOfflineBanner);
  window.addEventListener("offline", updateOfflineBanner);
  updateOfflineBanner();
  render();
}

function toggleDataSaver() {
  dataSaver = !dataSaver;
  saveDataSaver(dataSaver);
  const btn = document.querySelector("#dataSaverToggle");
  if (btn) btn.textContent = t(dataSaver ? "dataSaverOn" : "dataSaverOff");
  render();
}

function updateOfflineBanner() {
  const banner = document.querySelector("#offlineBanner");
  if (banner) banner.classList.toggle("hidden", navigator.onLine);
}

let groupMode = false;
function openCreateDialog(isGroup) {
  groupMode = isGroup;
  document.querySelector("#createTitle").textContent = isGroup ? "New group" : "New encrypted chat";
  document.querySelector("#invitee").placeholder = isGroup ? "@kwame:example.org, @amina:example.org" : "@kwame:example.org";
  document.querySelector("#groupNameField").classList.toggle("hidden", !isGroup);
  document.querySelector("#groupName").required = isGroup;
  document.querySelector("#dialog").showModal();
}

function rooms() { return (mx?.getRooms() || []).filter(r => r.getMyMembership() === "join"); }

const mediaUrl = mxc => { try { return mx.mxcUrlToHttp(mxc); } catch { return ""; } };

function renderMessageBody(e) {
  const content = e.getContent() || {};
  const msgtype = content.msgtype;
  const eventId = e.getId();
  const revealed = !dataSaver || revealedMedia.has(eventId);
  const size = formatBytes(content.info?.size);

  if (msgtype === "m.image" && content.url) {
    if (!revealed) return mediaPlaceholder(eventId, "🖼️", t("tapToLoadImage"), size);
    return `<img class="media-image" src="${esc(mediaUrl(content.url))}" alt="${esc(content.body||"image")}">`;
  }
  if (msgtype === "m.audio" && content.url) {
    if (!revealed) return mediaPlaceholder(eventId, "🎙️", t("tapToLoadAudio"), size);
    return `<audio controls src="${esc(mediaUrl(content.url))}"></audio>`;
  }
  if (msgtype === "m.file" && content.url) {
    if (!revealed) return mediaPlaceholder(eventId, "📄", t("tapToLoadFile"), size);
    return `<a class="media-file" href="${esc(mediaUrl(content.url))}" target="_blank" rel="noopener">📄 ${esc(content.body||"file")}</a>`;
  }
  return `<p>${esc(content.body||"")}</p>`;
}

// Low-data / download-on-demand placeholder: shown instead of eagerly
// fetching media bytes. Revealing is per-event and only lives for this
// browser session so re-opening the app doesn't silently re-spend data.
function mediaPlaceholder(eventId, icon, label, size) {
  return `<button type="button" class="media-placeholder reveal-btn" data-event-id="${esc(eventId)}">
    <span class="media-placeholder-icon">${icon}</span>
    <span class="media-placeholder-label">${esc(label)}${size ? ` · ${esc(size)}` : ""}</span>
  </button>`;
}

function statusBadge(e) {
  const status = e.status; // null once sent/remote; "sending" | "not_sent" | "queued" while local
  if (!status) return "";
  if (status === "not_sent") return '<span class="status-badge failed">Failed · tap to retry</span>';
  return '<span class="status-badge pending">Sending…</span>';
}

function render() {
  if (!mx || !document.querySelector("#rooms")) return;
  const list = document.querySelector("#rooms"); list.innerHTML = "";
  for (const r of rooms()) {
    const b = document.createElement("button"); b.className = `room ${r.roomId===roomId?"active":""}`;
    b.textContent = r.name || r.roomId; b.onclick = () => {roomId=r.roomId; render();}; list.appendChild(b);
  }
  const r = roomId ? mx.getRoom(roomId) : null;
  const head=document.querySelector("#head"), tl=document.querySelector("#timeline"), form=document.querySelector("#send");
  const outboxCount = loadOutbox().filter(item => item.roomId === roomId).length;
  if (!r) { head.innerHTML=`<h2>${esc(t("noConversation"))}</h2>`; tl.innerHTML=`<div class="hero"><div class="brand">R</div><h2>${esc(t("startEncrypted"))}</h2></div>`; form.classList.add("hidden"); return; }
  const memberCount = r.getJoinedMemberCount ? r.getJoinedMemberCount() : 2;
  head.innerHTML=`<div><p class="eyebrow">${esc(t(memberCount>2?"encryptedGroup":"encryptedRoom"))}</p><h2>${esc(r.name||r.roomId)}</h2></div><span class="secure">${esc(t("secure"))}</span>`;
  form.classList.remove("hidden");
  const events=r.getLiveTimeline().getEvents().filter(e=>e.getType()==="m.room.message"&&e.getContent()?.body);
  tl.innerHTML=(events.map(e=>`<article class="message ${e.getSender()===mx.getUserId()?"mine":""}" data-event-id="${esc(e.getId())}" data-sender="${esc(e.getSender())}">
      ${renderMessageBody(e)}
      <small>${esc(e.getSender())} ${statusBadge(e)} ${e.getSender()!==mx.getUserId()?`<button type="button" class="link-btn report-btn">${esc(t("report"))}</button>`:""}</small>
    </article>`).join("") || `<p class="muted">${esc(t("noMessages"))}</p>`)
    + (outboxCount ? `<p class="muted outbox-note">${outboxCount} ${esc(t("queuedOffline"))}</p>` : "");
  tl.scrollTop=tl.scrollHeight;
  tl.querySelectorAll(".report-btn").forEach(btn => {
    btn.onclick = () => openReportDialog(btn.closest(".message").dataset.sender, "message");
  });
  tl.querySelectorAll(".reveal-btn").forEach(btn => {
    btn.onclick = () => { revealedMedia.add(btn.dataset.eventId); render(); };
  });
}

async function createRoom(e) {
  e.preventDefault(); const err=document.querySelector("#createError");
  const invitees = document.querySelector("#invitee").value.split(",").map(s=>s.trim()).filter(Boolean);
  try {
    const opts = {
      invite: invitees,
      preset: groupMode ? "private_chat" : "trusted_private_chat",
      is_direct: !groupMode,
      initial_state:[{type:"m.room.encryption",state_key:"",content:{algorithm:"m.megolm.v1.aes-sha2"}}],
    };
    if (groupMode) opts.name = document.querySelector("#groupName").value.trim();
    const r=await mx.createRoom(opts);
    roomId=r.room_id; document.querySelector("#dialog").close(); render();
  } catch(x) { err.textContent=x?.message||"Unable to create room"; err.classList.remove("hidden"); }
}

async function send(e) {
  e.preventDefault(); const i=document.querySelector("#msg"), text=i.value.trim(); if(!text||!roomId)return; i.value="";
  try { await mx.sendTextMessage(roomId,text); }
  catch(x) {
    if (isOfflineError(x)) { queueOutboxMessage(roomId, text); render(); }
    else { i.value=text; alert(x?.message||"Message failed"); }
  }
}

async function sendAttachment(e) {
  const file = e.target.files?.[0]; e.target.value = ""; if (!file || !roomId) return;
  try {
    const url = await mx.uploadContent(file, { type: file.type });
    const msgtype = file.type.startsWith("image/") ? "m.image" : "m.file";
    await mx.sendMessage(roomId, { msgtype, body: file.name, url: url.content_uri || url, info: { mimetype: file.type, size: file.size } });
  } catch (x) { alert(x?.message || "Upload failed"); }
}

async function toggleVoiceRecording() {
  const micBtn = document.querySelector("#mic");
  if (mediaRecorder && mediaRecorder.state === "recording") { mediaRecorder.stop(); return; }
  if (!roomId) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = e => { if (e.data.size) recordedChunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      micBtn.textContent = "🎙️";
      const blob = new Blob(recordedChunks, { type: "audio/webm" });
      try {
        const url = await mx.uploadContent(blob, { type: "audio/webm" });
        await mx.sendMessage(roomId, { msgtype: "m.audio", body: "Voice message", url: url.content_uri || url, info: { mimetype: "audio/webm", size: blob.size } });
      } catch (x) { alert(x?.message || "Voice note upload failed"); }
    };
    mediaRecorder.start();
    micBtn.textContent = "■";
  } catch { alert("Microphone access denied or unavailable."); }
}

// --- Recovery key / secret storage hardening -------------------------------
// Cross-signing + secret storage let a person restore their encrypted room
// keys after signing in on a new device, instead of starting every
// conversation's history over. This is the roadmap's "recovery hardening"
// milestone. Setup is user-triggered (Security dialog) rather than automatic
// so a failure here never blocks login/registration; unlocking on a new
// device is attempted silently once per session and can also be retried
// manually.
let recoveryKeyPromptResolve = null;

function makeCryptoCallbacks() {
  return {
    getSecretStorageKey: async ({ keys }) => {
      const keyId = Object.keys(keys || {})[0];
      if (!keyId) return null;
      const entered = await promptForRecoveryKey();
      if (!entered) return null;
      try {
        return [keyId, decodeRecoveryKey(entered.trim())];
      } catch {
        return null;
      }
    },
  };
}

function promptForRecoveryKey() {
  return new Promise(resolve => {
    const dialog = document.querySelector("#recoveryEntryDialog");
    if (!dialog) return resolve(null);
    recoveryKeyPromptResolve = resolve;
    document.querySelector("#recoveryEntryError").classList.add("hidden");
    document.querySelector("#recoveryEntryValue").value = "";
    dialog.showModal();
  });
}

let recoveryUnlockAttempted = false;
async function attemptSilentRecoveryUnlock() {
  if (recoveryUnlockAttempted) return;
  recoveryUnlockAttempted = true;
  await attemptRecoveryUnlock(false);
}

async function attemptRecoveryUnlock(interactive) {
  const crypto = mx?.getCrypto();
  if (!crypto) return;
  try {
    if (await crypto.isSecretStorageReady()) {
      if (interactive) refreshSecurityStatus("✅ Recovery key is configured and unlocked on this device.");
      return;
    }
    await crypto.bootstrapSecretStorage({});
    if (interactive) {
      const ready = await crypto.isSecretStorageReady();
      refreshSecurityStatus(ready
        ? "✅ Recovery key unlocked on this device."
        : "⚠️ No recovery key found for this account yet — use \"Set up recovery key\" to create one.");
    }
  } catch {
    // No secret storage configured yet, or the user skipped the recovery
    // key prompt — safe to ignore; messaging still works without it.
    if (interactive) refreshSecurityStatus("⚠️ Could not unlock with that recovery key.");
  }
}

function refreshSecurityStatus(text) {
  const status = document.querySelector("#securityStatus");
  if (status) status.textContent = text;
}

async function openSecurityDialog() {
  const dialog = document.querySelector("#securityDialog");
  const status = document.querySelector("#securityStatus");
  dialog.showModal();
  status.textContent = "Checking recovery key status…";
  try {
    const crypto = mx?.getCrypto();
    const ready = crypto ? await crypto.isSecretStorageReady() : false;
    status.textContent = ready
      ? "✅ Recovery key is configured and unlocked on this device."
      : "⚠️ No recovery key unlocked on this device yet.";
  } catch {
    status.textContent = "Could not determine recovery key status.";
  }
}

function openRecoveryPasswordDialog() {
  document.querySelector("#recoveryPasswordError").classList.add("hidden");
  document.querySelector("#recoveryPassword").value = "";
  document.querySelector("#recoveryPasswordDialog").showModal();
}

async function submitRecoveryPassword(e) {
  e.preventDefault();
  const err = document.querySelector("#recoveryPasswordError");
  const password = document.querySelector("#recoveryPassword").value;
  try {
    await setUpRecoveryKey(password);
    document.querySelector("#recoveryPasswordDialog").close();
  } catch (x) {
    err.textContent = x?.message || "Could not set up recovery key.";
    err.classList.remove("hidden");
  }
}

async function setUpRecoveryKey(password) {
  const crypto = mx.getCrypto();
  if (!crypto) throw new Error("Encryption is not ready yet.");
  await crypto.bootstrapCrossSigning({
    authUploadDeviceSigningKeys: async makeRequest => {
      await makeRequest({
        type: "m.login.password",
        identifier: { type: "m.id.user", user: mx.getUserId() },
        password,
      });
    },
  });
  const recoveryKey = await crypto.createRecoveryKeyFromPassphrase();
  await crypto.bootstrapSecretStorage({
    createSecretStorageKey: async () => recoveryKey,
    setupNewKeyBackup: true,
    setupNewSecretStorage: true,
  });
  showRecoveryKey(recoveryKey.encodedPrivateKey);
  refreshSecurityStatus("✅ Recovery key is configured and unlocked on this device.");
}

function showRecoveryKey(encodedKey) {
  document.querySelector("#recoveryKeyValue").textContent = encodedKey || "";
  document.querySelector("#recoveryKeyDialog").showModal();
}

async function copyRecoveryKey() {
  const value = document.querySelector("#recoveryKeyValue").textContent;
  try { await navigator.clipboard.writeText(value); } catch { /* clipboard unavailable; user can select manually */ }
}

function resolveRecoveryPrompt(value) {
  if (recoveryKeyPromptResolve) { recoveryKeyPromptResolve(value); recoveryKeyPromptResolve = null; }
}

async function submitRecoveryEntry(e) {
  e.preventDefault();
  const value = document.querySelector("#recoveryEntryValue").value;
  document.querySelector("#recoveryEntryDialog").close();
  resolveRecoveryPrompt(value);
}

// --- Reporting ---------------------------------------------------------
let reportTarget = null;
function openReportDialog(targetId, targetType) {
  reportTarget = { targetId, targetType };
  document.querySelector("#reportError").classList.add("hidden");
  document.querySelector("#reportDialog").showModal();
}

async function submitReport(e) {
  e.preventDefault();
  const err = document.querySelector("#reportError");
  if (!reportTarget) return;
  try {
    const r = await fetch(`${MODERATION_URL}/reports`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reporterId: mx.getUserId(),
        targetId: reportTarget.targetId,
        targetType: reportTarget.targetType,
        reasonCode: document.querySelector("#reasonCode").value,
        context: document.querySelector("#reportContext").value.trim() || undefined,
      }),
    });
    if (!r.ok) throw new Error((await r.json())?.error || "Report failed");
    document.querySelector("#reportDialog").close();
  } catch (x) { err.textContent = x?.message || "Unable to submit report"; err.classList.remove("hidden"); }
}

async function logout() {
  try { await mx?.logout(true); } catch {}
  mx?.stopClient(); mx=null; roomId=null; clear(); login();
}

(async()=>{ const s=load(); if(!s)return login(); try{await start(s);}catch(e){clear();login(`Session restore failed: ${e?.message||"unknown error"}`);} })();
