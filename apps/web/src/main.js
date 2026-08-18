import { createClient } from "matrix-js-sdk";
import "./styles.css";

const DEFAULT_HOMESERVER = import.meta.env.VITE_MATRIX_HOMESERVER_URL || "http://localhost:8008";
const SESSION_KEY = "relay.matrix.session.v1";
let client = null;
let activeRoomId = null;

const app = document.querySelector("#app");
const esc = (v = "") => String(v).replace(/[&<">']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));

function saveSession(s) { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); }
function loadSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || "null"); }
  catch { return null; }
}
function clearSession() { localStorage.removeItem(SESSION_KEY); }

function loginView(error = "") {
  app.innerHTML = `
    <main class="auth-shell">
      <section class="auth-card">
        <div class="brand">R</div>
        <p class="eyebrow">Relay Messenger</p>
        <h1>Private messaging built for real-world networks.</h1>
        <p class="muted">Development client connected directly to a Matrix homeserver.</p>
        <form id="loginForm">
          <label>Homeserver URL<input id="homeserver" type="url" value="${esc(DEFAULT_HOMESERVER)}" required></label>
          <label>Matrix user ID<input id="userId" placeholder="@ama:example.org" required></label>
          <label>Password<input id="password" type="password" autocomplete="current-password" required></label>
          <button id="loginBtn" type="submit">Sign in</button>
          <p id="loginError" class="error ${error ? "" : "hidden"}">${esc(error)}</p>
        </form>
        <p class="security-note">Development milestone: session tokens are persisted locally for restart testing. Production credential hardening is still required.</p>
      </section>
    </main>`;
  document.querySelector("#loginForm").addEventListener("submit", login);
}

async function login(event) {
  event.preventDefault();
  const btn = document.querySelector("#loginBtn");
  btn.disabled = true;
  const baseUrl = document.querySelector("#homeserver").value.replace(/\/+$/, "");
  const userId = document.querySelector("#userId").value.trim();
  const password = document.querySelector("#password").value;
  try {
    const authClient = createClient({ baseUrl });
    const result = await authClient.loginWithPassword(userId, password);
    const session = {
      baseUrl,
      accessToken: result.access_token,
      userId: result.user_id,
      deviceId: result.device_id,
    };
    saveSession(session);
    await startSession(session);
  } catch (err) {
    loginView(err?.message || "Login failed");
  }
}

async function startSession(session) {
  loadingView("Opening encrypted session…");
  client = createClient({
    baseUrl: session.baseUrl,
    accessToken: session.accessToken,
    userId: session.userId,
    deviceId: session.deviceId,
  });

  // Matrix's maintained Rust crypto implementation. No custom cryptography.
  await client.initRustCrypto();

  client.on("sync", (state) => {
    const dot = document.querySelector("#syncDot");
    const label = document.querySelector("#syncLabel");
    if (!dot || !label) return;
    const ready = state === "SYNCING" || state === "PREPARED";
    dot.classList.toggle("online", ready);
    label.textContent = ready ? "Synced" : state;
    if (state === "PREPARED") {
      renderRooms();
      renderActiveRoom();
    }
  });

  client.on("Room.timeline", (_event, room) => {
    renderRooms();
    if (room?.roomId === activeRoomId) renderActiveRoom();
  });

  client.on("Room.name", renderRooms);
  client.startClient({ initialSyncLimit: 50 });
  appView();
}

function loadingView(message) {
  app.innerHTML = `<main class="loading"><div class="spinner"></div><p>${esc(message)}</p></main>`;
}

function appView() {
  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <header class="side-head">
          <div class="brand small">R</div>
          <div><p class="eyebrow">Relay</p><strong>${esc(client?.getUserId() || "")}</strong></div>
          <button id="logout" class="ghost">Log out</button>
        </header>
        <div class="sync"><span id="syncDot"></span><span id="syncLabel">Connecting…</span></div>
        <button id="newChat" class="new-chat">＋ New encrypted chat</button>
        <div id="rooms" class="rooms"></div>
      </aside>
      <main class="conversation">
        <header id="roomHeader" class="room-header"></header>
        <section id="timeline" class="timeline"></section>
        <form id="composer" class="composer disabled">
          <textarea id="message" rows="1" placeholder="Write a message" required></textarea>
          <button type="submit">Send</button>
        </form>
      </main>
    </div>
    <dialog id="newChatDialog">
      <form id="newChatForm">
        <p class="eyebrow">Encrypted direct chat</p>
        <h2>Start a conversation</h2>
        <label>Matrix ID<input id="invitee" placeholder="@kwame:example.org" required></label>
        <p id="dialogError" class="error hidden"></p>
        <div class="dialog-actions">
          <button id="cancelChat" type="button" class="secondary">Cancel</button>
          <button type="submit">Create</button>
        </div>
      </form>
    </dialog>`;

  document.querySelector("#logout").addEventListener("click", logout);
  document.querySelector";