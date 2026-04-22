# PhilateLister Chrome Plugin

This extension adds a right-click action on images:

- `Analyze stamp centering (PhilateLister)`

When clicked, it:

1. Opens `http://localhost:8000/public/test/opencv_centering.html`.
2. Passes the clicked image as `image_url=...`.
3. Starts centering analysis in that page.

## Load in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder: `browser_plugin/`.

## Notes

- Uses Manifest V3.
- Run a local server first, for example:
  - `python3 -m http.server 8000`
- OpenCV runs in the normal web page context (not extension page context), which avoids MV3 CSP `unsafe-eval` restrictions from OpenCV.js.
