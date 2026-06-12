# Awesome Testing Tools — the site

A static single-page site that renders every tool from the repo's [`readme.md`](../readme.md)
as a card, with a retro-TV hero acting as the detail view: click a card to "tune" that tool
into the TV screen. Every tool has a shareable deep link (`…/#cypress`).

## How the pipeline works

The readme is the single source of truth — nothing here is hardcoded:

```
readme.md ──> scripts/parse-readme.mjs ──> site/data/tools.json ──> app.js renders the page
```

1. [`scripts/parse-readme.mjs`](../scripts/parse-readme.mjs) (Node 20+, no dependencies)
   parses the markdown tables under each `##` heading. It normalizes prices to
   `free` / `paid` / `freemium`, extracts the first http(s) URL from messy link cells,
   strips inline markdown from descriptions, merges duplicate category sections
   (deduplicating tools by name, keeping the longer description), title-cases category
   names, and assigns each tool a slug `id` plus a deterministic 2-digit TV `channel`.
   Malformed rows are skipped with a warning instead of failing the build.
2. The site is plain HTML/CSS/JS — no framework, no bundler. `app.js` fetches
   `data/tools.json` with a relative path, so it works from the GitHub Pages
   project subpath.
3. [`.github/workflows/deploy.yml`](../.github/workflows/deploy.yml) rebuilds
   `tools.json` and redeploys to GitHub Pages on every push to `master` that touches
   `readme.md`, `site/`, or `scripts/`. One-time setup: in repo **Settings → Pages**,
   set the source to **GitHub Actions**.

`site/data/tools.json` is a build artifact — regenerate it, don't edit it.

## Running locally

```bash
node scripts/parse-readme.mjs   # readme.md -> site/data/tools.json
python3 -m http.server 8123 -d site   # or: npx serve site
```

Then open <http://localhost:8123/>. A server is needed (rather than `file://`)
because the page fetches `data/tools.json`.

## TV controls

- Click any card to tune it in; the ◂ ▸ knobs (or ←/→ when the TV has focus) change channel.
- The category chips above the grid filter the cards; the knobs then cycle through
  the filtered list only.
- The power knob returns to the off-air test pattern; `Esc` does the same.
- The screen is an `aria-live` region, and all animations respect `prefers-reduced-motion`.
