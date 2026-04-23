# PhilateLister Chrome Plugin

This extension adds a right-click action on images with two options:

- `AI analysis`
- `Centering analysis`

When clicked, it:

1. Fetches the clicked image in the extension.
2. Converts it to a Base64 data URL and stores it in `chrome.storage.local` as `pendingStamp`.
3. Opens the selected page and passes `extension_id=...`.
4. The page requests the image back via `chrome.runtime.sendMessage(extensionId, { type: "GET_STAMP_DATA" })`.
5. Starts either AI listing analysis or centering analysis in that page.

## Configure token password

The AI analysis option appends `token_password` to the opened URL.

To configure it:

1. Open `chrome://extensions`.
2. Find **PhilateLister Image Analyzer**.
3. Click **Details**.
4. Click **Extension options**.
5. Set **AI token password** and save.

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
