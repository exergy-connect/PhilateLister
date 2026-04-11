# PhilateLister — technical design

For small apps like PhilateLister, combining a **static web dashboard** with **GitHub Issues** is a practical default: you capture structured, high-quality data through the browser, while dealers who prefer something familiar can still “email” stamps into the system by opening an issue and attaching a photo.

## Dual-entry overview

| | **Method A: web dashboard** | **Method B: “old style” issue** |
| --- | --- | --- |
| **User interface** | Modern HTML/JS form on GitHub Pages | Standard GitHub **New issue** screen |
| **Authentication** | Fine-grained personal access token (heavily restricted) | Dealer’s own GitHub login |
| **Data flow** | Pushes JSON/image into the repo (e.g. `uploads/`) | User attaches an image to the issue |
| **AI trigger** | `on: push` in GitHub Actions | `on: issues: [opened]` in GitHub Actions |

## Web dashboard (GitHub Pages)

Host a simple `index.html` on GitHub Pages. Uploads typically go through the [GitHub Contents API](https://docs.github.com/en/rest/repos/contents) using a **fine-grained personal access token** scoped to the smallest surface possible.

**Security (static sites):** In a purely static page, any secret embedded in JavaScript is recoverable by anyone who can load the page. Mitigate by issuing a token that can **only** write to a dedicated uploads repo (or a single path), with **no** org-wide or unrelated permissions—so a leak limits blast radius, not eliminates risk. Prefer server-side or OAuth-based flows when you outgrow this pattern.

Illustrative upload flow:

```javascript
async function uploadToArchive() {
  const photo = document.getElementById("stampFile").files[0];
  const price = document.getElementById("targetPrice").value;
  const base64Img = await toBase64(photo);

  const response = await fetch(
    `https://api.github.com/repos/OWNER/PhilateLister-Uploads/contents/uploads/${photo.name}`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({
        message: `Stamp upload: ${price}`,
        content: base64Img.split(",")[1],
      }),
    }
  );

  if (response.ok) showSuccess();
}
```

(`TOKEN` here stands in for however you inject the PAT at build or deploy time—never commit a real token.)

The reference form is [`index.html`](index.html) at the repo root: it uploads to `uploads/stamp_<YYYY-MM-DD_hh-mm-ss-mmm>_<sanitized-original-stem>_<id>.<ext>` and uses a commit message `PhilateLister upload: <basename>` plus JSON (`file`, `targetPrice`, `notes`) so Actions can parse a single push. Workflow: [`.github/workflows/on-upload.yml`](.github/workflows/on-upload.yml) (path filter `uploads/**`).

### GitHub Pages rebuilds

Uploads and listing outputs are committed to **`main`** (see `<meta name="philatelister-branch" content="main">` in [`index.html`](index.html)). If **GitHub Pages** also builds from **`main`**, each upload commit can trigger a **Pages rebuild**; that is accepted for this setup so workflow and site stay on one branch.

## Issue tracker fallback

For dealers who dislike forms: *“Open a new issue and drag your photo in.”* A workflow can listen for `issues: opened`, read the attachment, run vision + text generation, and **post the eBay draft as a comment** on the same issue.

Example workflow skeleton:

```yaml
# .github/workflows/issue_bot.yml
on:
  issues:
    types: [opened]

jobs:
  ai_appraisal:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - name: Analyze issue attachment
        env:
          GEMINI_API_KEY: ${{ secrets.GEMINI_API_KEY }}
        run: |
          # Resolve image URL from the issue, call the model, comment back.
          python scripts/process_issue.py
```

## Collection: JSON “database” in `/archive`

Each successful run can do a **double save**:

1. **For the dealer** — Copy-paste eBay description (and any UI copy).
2. **For the dataset** — Append a schema-shaped JSON file under `archive/`, e.g. `archive/2026-04-10_penny-black.json`, with fields such as country, year, catalog numbers, and a pointer to the stored image path.

Over time, `archive/` becomes an AI-labeled corpus you own—useful for search, quality checks, and future training—while dealers still get fast listings.

## Cost at modest scale

GitHub Pages, Actions within free allowances, and a small vision model on a free or low-cost tier can keep marginal cost near **$0** for hobby and early-dealer volume. Adjust as traffic and API pricing change.

---

Copyright (C) 2026 Exergy ∞ LLC.
