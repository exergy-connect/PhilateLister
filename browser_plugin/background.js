const MENU_ID = "philatelister-centering-analyze-image";
const ANALYZE_BASE_URL = "http://localhost:8000/public/test/opencv_centering.html";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Analyze stamp centering (PhilateLister)",
      contexts: ["image"],
    });
  });
});

chrome.runtime.onStartup.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: MENU_ID,
      title: "Analyze stamp centering (PhilateLister)",
      contexts: ["image"],
    });
  });
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== MENU_ID) return;
  if (!info.srcUrl) return;

  try {
    const url = new URL(ANALYZE_BASE_URL);
    url.searchParams.set("image_url", info.srcUrl);
    await chrome.tabs.create({ url: url.toString() });
  } catch (err) {
    const url = new URL(chrome.runtime.getURL("analyze.html"));
    url.searchParams.set(
      "error",
      err instanceof Error
        ? err.message
        : "Could not open the analyzer page. Ensure your local server is running on localhost:8000."
    );
    await chrome.tabs.create({ url: url.toString() });
  }
});
