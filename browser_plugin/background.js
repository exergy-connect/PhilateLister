const MENU_ID = "philatelister-centering-analyze-image";
const ANALYZE_BASE_URL = "https://exergy-connect.github.io/PhilateLister/test/opencv_centering.html";

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

  const url = new URL(ANALYZE_BASE_URL);
  url.searchParams.set("image_url", info.srcUrl);
  await chrome.tabs.create({ url: url.toString() });
});
