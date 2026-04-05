# Podcast Splitter

Static web app that splits a podcast into labeled, speed-adjusted MP3 parts for screenless sports headphones. Everything runs locally in the browser — audio never leaves your machine.

**Live:** https://titan550.github.io/PodcastSplitter/

## What it does

1. Load an audio file (MP3, M4A, M4B, AAC, WAV, OGG, Opus, FLAC, WebM).
2. Split by embedded chapters if present, otherwise by time (default 5 min, snapped to nearby silences).
3. Prepend a spoken label to each part — `"Part N of {Title}"` or `"Chapter N of {Title}. {Chapter}"` — synthesized locally via Piper TTS.
4. Speed up the podcast body (default 1.25×), prefix stays at 1×.
5. Optionally strip long internal silences.
6. Download everything as a single ZIP with sortable, grouped filenames.

## Develop

```bash
npm install
npm run dev     # dev server sets COOP/COEP so crossOriginIsolated === true
npm test        # vitest
npm run build   # root base; set VITE_BASE_URL=/Repo/ for subpath deploys
```

## Deploy

The app needs `crossOriginIsolated` for `SharedArrayBuffer` (ffmpeg + ORT threading). Two paths, same build:

- **Cloudflare / Netlify** — `public/_headers` provides COOP/COEP. Point the host at `npm run build` → `dist/`.
- **GitHub Pages** — no custom headers allowed, so `public/coi-sw.js` is a tiny service worker that re-responds with COOP/COEP client-side. The workflow at `.github/workflows/pages.yml` builds on push to `main` with `VITE_BASE_URL=/<repo>/` and deploys. First visit reloads once for the SW to take control.

## Architecture

- **All WASM self-hosted** under `/ffmpeg/`, `/ort/`, `/piper/` (COEP forbids cross-origin loads). Paths resolve through `src/lib/assetUrl.ts` so both root and subpath deploys work.
- **Parallel encoding** — a pool of ffmpeg workers pulls from a shared cursor; a promise-chain mutex guarantees ZIP entries are written in strict part order.
- **TTS pipelining** — the audio worker fires all TTS requests upfront; main-thread Piper synthesizes serially while ffmpeg encodes in parallel, with a target-worker tag to discard stale results after cancel.
- **Why Piper, not `speechSynthesis`** — the Web Speech API can't export audio to a file, and each prefix has to be muxed into its MP3. Piper produces 22050 Hz mono WAV (~17 MB voice model, cached in OPFS).

### Caching

| Data | Storage |
|---|---|
| Piper voice model | OPFS |
| ffmpeg / ORT / Piper WASM | HTTP cache (self-hosted) |
| Generated prefix audio | IndexedDB, keyed by text + voice |
| User settings | localStorage |

First load pulls ~50 MB total (ffmpeg ~25, ORT ~8, voice ~17); everything is cached after.

## Mobile notes

- Conservative memory use on iOS; files >200 MB may hit pressure limits.
- Wake Lock API keeps the screen on during processing (Safari 16.4+).
- Download may open inline on iOS — use "Save to Files".

## Stack

Vite · React · TypeScript · @ffmpeg/ffmpeg · @mintplex-labs/piper-tts-web · onnxruntime-web · @zip.js/zip.js · music-metadata · idb-keyval · vanilla CSS
