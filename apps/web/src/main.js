import { createClient } from "matrix-js-sdk";
import "./styles.css";

const app = document.querySelector("#app");
const KEY = "relay.matrix.session.v1";
const home = import.meta.env.VITE_MATRIX_HOMESERVER_URL || "http://localhost:8008";
let mx, roomId;

const esc = (s="") => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
const save = s => localStorage.setItem(KEY, JSON.stringify(s));
const clear = () => localStorage.removeItem(KEY);

function login(error="") {
  app.innerHTML = `<main class="auth"><section class="card">
    <div class="brand">R</div><p class="eyebrow">Relay Messenger</p>
    <h1>Private messaging for real-world networks.</h1>
    <p class="muted">Development client using a real Matrix SDK.</p>
    <form id="login"><label>Homeserver<input id="hs" type="url" value="${esc(home)}" required></label>
    <label>Matrix ID<input id="uid" placeholder="@ama:example.org" required></label>
    <label>Password<input id="pw" type="password" required></label>
    <button>Sign in</button><p class="error ${error?"":"hidden"}">${esc(error)}</p></form>
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
}

async function start(s) {
  app.innerHTML = `<main class="loading">Opening encrypted session…</main>`;
  mx = createClient({baseUrl:s.baseUrl, accessToken:s.accessToken, userId:s.userId, deviceId:s.deviceId});
  await mx.initRustCrypto();
  mx.on("sync", state => { if (state === "PREPARED") render(); });
  mx.on("Room.timeline", (_e,r) => { if (!roomId || r?.roomId === roomId) render(); });
  mx.startClient({initialSyncLimit:50});
  shell();
}

function shell() {
  app.innerHTML = `<div class="shell"><aside>
    <header><div class="brand small">R</div><div><p class="eyebrow">Relay</p><strong>${esc(mx.getUserId())}</strong></div></header>
    <button id="new">＋ New encrypted chat</button><div id="rooms"></div><button id="logout" class="secondary">Log out</button>
  </aside><main class="chat"><header id="head"></header><section id="timeline"></section>
    <form id="send" class="send hidden"><textarea id="msg" rows="1" placeholder="Write a message" required></textarea><button>Send</button></form>
  </main></div><dialog id="dialog"><form id="create"><h2>New encrypted chat</h2>
    <label>Matrix ID<input id="invitee" placeholder="@kwame:example.org" required></label>
    <p id="createError" class="error hidden"></p><div class="actions"><button type="button" id="cancel" class="secondary">Cancel</button><button>Create</button></div>
  </form></dialog>`;
  document.querySelector("#new").onclick = () => document.querySelector("#dialog").showModal();
  document.querySelector("#cancel").onclick = () => document.querySelector("#dialog").close();
  document.querySelector("#logout").onclick = logout;
  document.querySelector("#create").onsubmit = createRoom;
  document.querySelector("#send").onsubmit = send;
  render();
}

function rooms() { return (mx?.getRooms() || []).filter(r => r.getMyMembership() === "join"); }

function render() {
  if (!mx || !document.querySelector("#rooms")) return;
  const list = document.querySelector("#rooms"); list.innerHTML = "";
  for (const r of rooms()) {
    const b = document.createElement("button"); b.className = `room ${r.roomId===roomId?"active":""}`;
    b.textContent = r.name || r.roomId; b.onclick = () => {roomId=r.roomId; render();}; list.appendChild(b);
  }
  const r = roomId ? mx.getRoom(roomId) : null;
  const head=document.querySelector("#head"), tl=document.querySelector("#timeline"), form=document.querySelector("#send");
  if (!r) { head.innerHTML="<h2>No conversation selected</h2>"; tl.innerHTML='<div class="hero"><div class="brand">R</div><h2>Start a real encrypted conversation.</h2></div>'; form.classList.add("hidden"); return; }
  head.innerHTML=`<div><p class="eyebrow">Encrypted room</p><h2>${esc(r.name||r.roomId)}</h2></div><span class="secure">E2EE room</span>`;
  form.classList.remove("hidden");
  const events=r.getLiveTimeline().getEvents().filter(e=>e.getType()==="m.room.message"&&e.getContent()?.body);
  tl.innerHTML=events.map(e=>`<article class="message ${e.getSender()===mx.getUserId()?"mine":""}"><p>${esc(e.getContent().body)}</p><small>${esc(e.getSender())}</small></article>`).join("") || '<p class="muted">No messages yet.</p>';
  tl.scrollTop=tl.scrollHeight;
}

async function createRoom(e) {
  e.preventDefault(); const err=document.querySelector("#createError");
  try {
    const r=await mx.createRoom({is_direct:true, invite:[document.querySelector("#invitee").value.trim()], preset:"trusted_private_chat",
      initial_state:[{type:"m.room.encryption",state_key:"",content:{algorithm:"m.megolm.v1.aes-sha2"}}]});
    roomId=r.room_id; document.querySelector("#dialog").close(); render();
  } catch(x) { err.textContent=x?.message||"Unable to create room"; err.classList.remove("hidden"); }
}

async function send(e) {
  e.preventDefault(); const i=document.querySelector("#msg"), text=i.value.trim(); if(!text||!roomId)return; i.value="";
  try { await mx.sendTextMessage(roomId,text); } catch(x) { i.value=text; alert(x?.message||"Message failed"); }
}

async function logout() {
  try { await mx?.logout(true); } catch {}
  mx?.stopClient(); mx=null; roomId=null; clear(); login();
}

(async()=>{ const s=load(); if(!s)return login(); try{await start(s);}catch(e){clear();login(`Session restore failed: ${e?.message||"unknown error"}`);} })();
