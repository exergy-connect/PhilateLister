const AI_TOKEN_PASSWORD_KEY = "aiTokenPassword";
const DEFAULT_AI_TOKEN_PASSWORD = "<not set>";

const inputEl = document.getElementById("ai-token-password");
const saveBtn = document.getElementById("save-btn");
const statusEl = document.getElementById("status");

function showStatus(message, cls = "") {
  statusEl.textContent = message;
  statusEl.className = cls;
}

async function loadOptions() {
  try {
    const items = await chrome.storage.local.get(AI_TOKEN_PASSWORD_KEY);
    const value = String(items?.[AI_TOKEN_PASSWORD_KEY] ?? "").trim() || DEFAULT_AI_TOKEN_PASSWORD;
    inputEl.value = value;
    showStatus("");
  } catch (err) {
    showStatus(err instanceof Error ? err.message : String(err), "error");
  }
}

async function saveOptions() {
  const value = String(inputEl.value ?? "").trim() || DEFAULT_AI_TOKEN_PASSWORD;
  try {
    await chrome.storage.local.set({ [AI_TOKEN_PASSWORD_KEY]: value });
    inputEl.value = value;
    showStatus("Saved.", "ok");
  } catch (err) {
    showStatus(err instanceof Error ? err.message : String(err), "error");
  }
}

saveBtn.addEventListener("click", () => {
  saveOptions();
});

document.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") {
    ev.preventDefault();
    saveOptions();
  }
});

loadOptions();
