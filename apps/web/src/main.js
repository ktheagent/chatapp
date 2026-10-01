import { createClient } from "matrix-js-sdk";
import "./styles.css";

const app = document.querySelector("#app");
const KEY = "relay.matrix.session.v1";
const OUTBOX_KEY = "relay.outbox.v1";
const home = import.meta.env.VITE_MATRIX_HOMESERVER_URL || "http://localhost:8008";
const IDENTITY_URL = import.meta.env.VITE_RELAY_IDENTITY_URL || "http://localhost:9001";
const MODERATION_URL = import.meta.env.VITE_RELAY_MODERATION_URL || "http://localhost:9002";
let mx, roomId, mediaRecorder, recordedChunks = [];

const esc = (s="") => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
const save = s => localStorage.setItem(KEY, JSON.stringify(s));
const clear = () => localStorage.removeItem(KEY);

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

function isOfflineError(err) {
  return !navigator.onLine || err?.name === "ConnectionError" || /network|fetch/i.test(err?.message || "");
}

function login(error="") {
  app.innerHTML = `<main class="auth"><section class="card">
    <div class="brand">R</div><p class="eyebrow">Relay Messenger</p>
    <h1>Private messaging for real-world networks.</h1>
    <p class="muted">Development client using a real Matrix SDK.</p>
    <form id="login"><label>Homeserver<input id="hs" type="url" value="${esc(home)}" required></label>
    <label>Matrix ID<input id="uid" placeholder="@ama:example.org" required></label>
    <label>Password<input id="pw" type="password" required></label>
    <button>Sign in</button><p class="error ${error?"":"hidden"}">${esc(error)}</p></form>
    <p class="muted">New to Relay? <a href="#" id="toRegister">Create a stable handle</a></p>
    <small>Development milestone: token persistence still requires production hardening.</small>
  </section></main>`;
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
    <div class="brand">R</div><p class="eyebrow">Relay Messenger</p>
    <h1>Create your Relay handle.</h1>
    <p class="muted">Your handle stays yours even if you change phone numbers later.</p>
    <form id="register"><label>Homeserver<input id="hs" type="url" value="${esc(home)}" required></label>
    <label>Stable handle<input id="handle" placeholder="ama" pattern="[a-z][a-z0-9_]{2,31}" required>
      <small id="handleStatus" class="muted"></small></label>
    <label>Password<input id="pw" type="password" minlength="8" required></label>
    <label>Confirm password<input id="pw2" type="password" minlength="8" required></label>
    <button>Create account</button><p class="error ${error?"":"hidden"}">${esc(error)}</p></form>
    <p class="muted">Already have an account? <a href="#" id="toLogin">Sign in</a></p>
  </section></main>`;

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
  mx = createClient({baseUrl:s.baseUrl, accessToken:s.accessToken, userId:s.userId, deviceId:s.deviceId});
  await mx.initRustCrypto();
  mx.on("sync", state => { if (state === "PREPARED") { render(); flushOutbox(); } });
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
    <button id="new">＋ New encrypted chat</button><button id="newGroup" class="secondary">＋ New group</button>
    <div id="offlineBanner" class="offline hidden">You're offline — messages will send automatically once you reconnect.</div>
    <div id="rooms"></div><button id="logout" class="secondary">Log out</button>
  </aside><main class="chat"><header id="head"></header><section id="timeline"></section>
    <form id="send" class="send hidden">
      <input id="file" type="file" class="hidden">
      <button type="button" id="attach" class="secondary icon" title="Attach file">📎</button>
      <button type="button" id="mic" class="secondary icon" title="Record voice note">🎙️</button>
      <textarea id="msg" rows="1" placeholder="Write a message"></textarea><button>Send</button>
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
  window.addEventListener("online", updateOfflineBanner);
  window.addEventListener("offline", updateOfflineBanner);
  updateOfflineBanner();
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
  if (msgtype === "m.image" && content.url) {
    return `<img class="media-image" src="${esc(mediaUrl(content.url))}" alt="${esc(content.body||"image")}">`;
  }
  if (msgtype === "m.audio" && content.url) {
    return `<audio controls src="${esc(mediaUrl(content.url))}"></audio>`;
  }
  if (msgtype === "m.file" && content.url) {
    return `<a class="media-file" href="${esc(mediaUrl(content.url))}" target="_blank" rel="noopener">📄 ${esc(content.body||"file")}</a>`;
  }
  return `<p>${esc(content.body||"")}</p>`;
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
  if (!r) { head.innerHTML="<h2>No conversation selected</h2>"; tl.innerHTML='<div class="hero"><div class="brand">R</div><h2>Start a real encrypted conversation.</h2></div>'; form.classList.add("hidden"); return; }
  const memberCount = r.getJoinedMemberCount ? r.getJoinedMemberCount() : 2;
  head.innerHTML=`<div><p class="eyebrow">${memberCount>2?"Encrypted group":"Encrypted room"}</p><h2>${esc(r.name||r.roomId)}</h2></div><span class="secure">E2EE room</span>`;
  form.classList.remove("hidden");
  const events=r.getLiveTimeline().getEvents().filter(e=>e.getType()==="m.room.message"&&e.getContent()?.body);
  tl.innerHTML=(events.map(e=>`<article class="message ${e.getSender()===mx.getUserId()?"mine":""}" data-event-id="${esc(e.getId())}" data-sender="${esc(e.getSender())}">
      ${renderMessageBody(e)}
      <small>${esc(e.getSender())} ${statusBadge(e)} ${e.getSender()!==mx.getUserId()?'<button type="button" class="link-btn report-btn">Report</button>':""}</small>
    </article>`).join("") || '<p class="muted">No messages yet.</p>')
    + (outboxCount ? `<p class="muted outbox-note">${outboxCount} message(s) queued — offline.</p>` : "");
  tl.scrollTop=tl.scrollHeight;
  tl.querySelectorAll(".report-btn").forEach(btn => {
    btn.onclick = () => openReportDialog(btn.closest(".message").dataset.sender, "message");
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
