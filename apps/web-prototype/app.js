const messages = [
  { mine: false, text: "Hi 👋 I found you by your Relay username instead of your phone number.", time: "22:36" },
  { mine: true, text: "Perfect. I’ve also set my number visibility to Nobody.", time: "22:37" },
  { mine: false, text: "I sent the measurements. Did you get them?", time: "22:41" },
];

const profiles = ["Friends", "Work", "Public", "Invisible"];
let activeProfile = localStorage.getItem("relayPrivacyProfile") || "Public";

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

function renderMessages() {
  const host = document.getElementById("messages");
  host.innerHTML = messages.map((message) => `
    <div class="bubble ${message.mine ? "mine" : ""}">
      <p>${escapeHtml(message.text)}</p>
      <small>${message.time}${message.mine ? " ✓✓" : ""}</small>
    </div>
  `).join("");
  host.scrollTop = host.scrollHeight;
}

function renderProfiles() {
  const host = document.getElementById("profiles");
  host.innerHTML = "";
  profiles.forEach((profile) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `pill ${profile === activeProfile ? "active" : ""}`;
    button.textContent = profile;
    button.addEventListener("click", () => {
      activeProfile = profile;
      localStorage.setItem("relayPrivacyProfile", activeProfile);
      renderProfiles();
    });
    host.appendChild(button);
  });
}

document.getElementById("composer").addEventListener("submit", (event) => {
  event.preventDefault();
  const input = document.getElementById("messageInput");
  const text = input.value.trim();
  if (!text) return;

  messages.push({
    mine: true,
    text,
    time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  });
  input.value = "";
  renderMessages();
});

document.querySelectorAll("[data-view]").forEach((button) => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".view").forEach((view) => view.classList.add("hidden"));
    document.getElementById(button.dataset.view).classList.remove("hidden");
    document.querySelectorAll("[data-view]").forEach((item) => {
      item.classList.toggle("active", item === button);
    });
  });
});

const dataMode = document.getElementById("dataMode");
dataMode.value = localStorage.getItem("relayDataMode") || "Automatic";
dataMode.addEventListener("change", () => {
  localStorage.setItem("relayDataMode", dataMode.value);
});

const phoneVisibility = document.getElementById("phoneVisibility");
phoneVisibility.value = localStorage.getItem("relayPhoneVisibility") || "Nobody";
phoneVisibility.addEventListener("change", () => {
  localStorage.setItem("relayPhoneVisibility", phoneVisibility.value);
});

document.getElementById("appeal").addEventListener("click", (event) => {
  event.currentTarget.disabled = true;
  document.getElementById("appealStatus").textContent =
    "Appeal status: Submitted. Prototype only; no server case was created.";
});

renderMessages();
renderProfiles();
