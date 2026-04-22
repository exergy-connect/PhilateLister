# PhilateLister Chrome Plugin

This extension adds a right-click action on images:

- `Analyze stamp centering (PhilateLister)`

When clicked, it:

1. Fetches the clicked image in the extension.
2. Converts it to a Base64 data URL and stores it in `chrome.storage.local` as `pendingStamp`.
3. Opens the analysis page and passes `extension_id=...`.
4. The analysis page requests the image back via `chrome.runtime.sendMessage(extensionId, { type: "GET_STAMP_DATA" })`.
5. Starts centering analysis in that page.

## Load in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `browser_plugin/`.

## Notes

- Uses Manifest V3.
- Uses `storage` + `unlimitedStorage` permissions for reliable Base64 relay payloads.
- Run a local server first, for example:
  - `python3 -m http.server 8000`
- `manifest.json` uses `externally_connectable.matches` for:
  - `https://exergy-connect.github.io/*`
  - `http://localhost/*`
  - `http://127.0.0.1/*`
- The plugin now only ships the background relay flow (no extension-side analyzer UI or worker bundle).
