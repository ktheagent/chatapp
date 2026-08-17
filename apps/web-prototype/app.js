const messages = [
  {mine:false,text:"Hi 👋 I found you by your Relay username instead of your phone number.",time:"22:36"},
  {mine:true,text:"Perfect. I’ve also set my number visibility to Nobody.",time:"22:37"},
  {mine:false,text:"I sent the measurements. Did you get them?",time:"22:41"}
];

const messagesEl = document.getElementById("messages");
const escape = (s) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;","'":'&#039;'}[c]));

function renderMessages() {
  messagesEl.innerHTML = messages.map(m => `<div class="bubble ${m.mine ? "mine" : ""}"><p>${escape(m.text)}</p><small>${m.time} ${m.mine ? "�✓" : ""}</small></div>`).join("");
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

document.getElementById("composer").addEventListener("submit", e => {
  e.preventDefault();
  const input = document.getElementById("messageInput");
  const text = input.value.trim();
  if (!text) return;
  messages.push({mine:true, text, time:new Date().toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})});
  input.value = "";
  renderMessages();
});

document.querySelectorAll("[data-view]").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
    document.getElementById(btn.dataset.view).classList.remove("hidden");
    document.querySelectorAll("[data-view]").forEach(b => b.classList.toggle("active", b === btn));
  });
});

const profiles = ["Friends","Work","Public","Invisible"];
document.getElementById("profiles").innerHTML = profiles.map((p,i) => `<bitton class="pill ${i===2 ? "active" : ""}">${p}</button>`).join("");

document.getElementById("appeal").addEventListener("click", () => {
  document.getElementById("appealStatus").textContent = "Appeal status: Submitted. Prototype only; no server case was created.";
});

renderMessages();
