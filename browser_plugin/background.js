const MENU_ROOT_ID = "philatelister-analyze-image-root";
const MENU_AI_ID = "philatelister-ai-analyze-image";
const MENU_CENTERING_ID = "philatelister-centering-analyze-image";
const AI_ANALYZE_BASE_URL = "https://exergy-connect.github.io/PhilateLister/";
const CENTERING_ANALYZE_BASE_URL = "https://exergy-connect.github.io/PhilateLister/test/opencv_centering.html";
const STORAGE_KEY = "pendingStamp";
const AI_TOKEN_PASSWORD_KEY = "aiTokenPassword";
const DEFAULT_AI_TOKEN_PASSWORD = "<not set>";

function ensureContextMenu() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ROOT_ID,
      title: "Analyze with PhilateLister",
      contexts: ["image"],
    });
    chrome.contextMenus.create({
      id: MENU_AI_ID,
      parentId: MENU_ROOT_ID,
      title: "AI analysis",
      contexts: ["image"],
    });
    chrome.contextMenus.create({
      id: MENU_CENTERING_ID,
      parentId: MENU_ROOT_ID,
      title: "Centering analysis",
      contexts: ["image"],
    });
  });
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function sourceUrlToDataUrl(sourceUrl) {
  const res = await fetch(sourceUrl, { cache: "no-store", credentials: "omit" });
  if (!res.ok) {
    throw new Error(`Failed to fetch image (HTTP ${res.status}).`);
  }
  const blob = await res.blob();
  if (!blob || (blob.type && !blob.type.startsWith("image/"))) {
    throw new Error("Right-clicked URL did not return an image.");
  }
  const b64 = arrayBufferToBase64(await blob.arrayBuffer());
  const mimeType = blob.type || "image/png";
  return { dataUrl: `data:${mimeType};base64,${b64}` };
}

chrome.runtime.onInstalled.addListener(() => {
  ensureContextMenu();
});

chrome.runtime.onStartup.addListener(() => {
  ensureContextMenu();
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  const isAi = info.menuItemId === MENU_AI_ID;
  const isCentering = info.menuItemId === MENU_CENTERING_ID;
  if (!isAi && !isCentering) return;
  if (!info.srcUrl) return;

  let openError = "";
  try {
    const payload = await sourceUrlToDataUrl(info.srcUrl);
    await chrome.storage.local.set({
      [STORAGE_KEY]: {
        ...payload,
        sourceUrl: info.srcUrl,
      },
    });
  } catch (err) {
    openError = err instanceof Error ? err.message : String(err);
  }

  let aiTokenPassword = DEFAULT_AI_TOKEN_PASSWORD;
  if (isAi) {
    try {
      const items = await chrome.storage.local.get(AI_TOKEN_PASSWORD_KEY);
      const fromStorage = String(items?.[AI_TOKEN_PASSWORD_KEY] ?? "").trim();
      if (fromStorage) aiTokenPassword = fromStorage;
    } catch (_) {
      // Fall back to default token password.
    }
  }

  const baseUrl = isAi ? AI_ANALYZE_BASE_URL : CENTERING_ANALYZE_BASE_URL;
  const url = new URL(baseUrl);
  url.searchParams.set("v", chrome.runtime.getManifest().version);
  url.searchParams.set("cb", String(Date.now()));
  url.searchParams.set("extension_id", chrome.runtime.id);
  if (isAi && aiTokenPassword) {
    url.searchParams.set("token_password", aiTokenPassword);
  }
  if (openError) url.searchParams.set("error", openError);
  await chrome.tabs.create({ url: url.toString() });
});

chrome.runtime.onMessageExternal.addListener((request, _sender, sendResponse) => {
  if (!request || request.type !== "GET_STAMP_DATA") return;

  chrome.storage.local.get(STORAGE_KEY, (items) => {
    const readErr = chrome.runtime.lastError;
    if (readErr) {
      sendResponse({ error: readErr.message || "Failed to read extension storage." });
      return;
    }
    const pendingStamp = items ? items[STORAGE_KEY] : null;
    if (!pendingStamp || !pendingStamp.dataUrl) {
      sendResponse({ image: null, error: "No pending stamp image was found." });
      return;
    }

    chrome.storage.local.remove(STORAGE_KEY, () => {
      const removeErr = chrome.runtime.lastError;
      if (removeErr) {
        sendResponse({ error: removeErr.message || "Failed to clear pending stamp image." });
        return;
      }
      sendResponse({
        image: pendingStamp.dataUrl,
        sourceUrl: pendingStamp.sourceUrl || "",
      });
    });
  });

  return true;
});
