# Podcast Splitter

A static web app that splits podcast audio files into labeled, speed-adjusted parts for screenless sports headphones. All processing runs locally in your browser.

## What it does

1. Upload one audio file (MP3, M4A, M4B, AAC, WAV, OGG, Opus, FLAC, or WebM)
2. App splits it into smaller parts — by detected chapters when available, otherwise by time (default 5 minutes each)
3. Prepends a spoken label to each part: "Part N of {Podcast Title}" or "Chapter N of {Podcast Title}. {Chapter Title}"
4. Speeds up podcast content (default 1.25x, prefix stays at normal speed)
5. Optionally strips long silences from each part
6. Exports all parts as MP3s in one ZIP, named so they group and sort cleanly when loaded into any audio player

## Local development

```bash
npm install
npm run dev
```

The dev server sets `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers. Verify `crossOriginIsolated === true` in your browser console.

## Build

```bash
npm run build         # root deploy (Cloudflare)
VITE_BASE_URL=/podcaster-b/ npm run build   # subpath deploy (GitHub Pages project page)
```

Output goes to `dist/`.

## Tests

```bash
npm test           # single run
npm run test:watch # watch mode
```

## Deploy

The site needs COOP/COEP headers for `SharedArrayBuffer` (multi-thread ffmpeg). Two supported hosts:

### Cloudflare Pages

1. Connect your repo to Cloudflare Pages
2. Build command: `npm run build`
3. Build output directory: `dist`
4. The `public/_headers` file provides the required COOP/COEP headers

### GitHub Pages

GitHub Pages doesn't support custom headers, so the app ships a tiny COI service worker (`public/coi-sw.js`) that re-responds with COOP/COEP headers client-side. Same-origin WASM loads then succeed.

1. Push to `main` — the `.github/workflows/pages.yml` workflow builds with `VITE_BASE_URL=/<repo-name>/` and deploys to GitHub Pages
2. On first visit, the service worker installs and the page reloads once so it takes control
3. Multi-thread ffmpeg still works after the reload because `crossOriginIsolated === true` once the SW is active

## Architecture

### Why static-only

- Cloudflare Pages / GitHub Pages: unlimited static asset requests, zero compute cost
- All audio processing runs in-browser via WebAssembly
- No account system, no database, no server-side state

### Why not browser speechSynthesis

The Web Speech API (`speechSynthesis`) can play audio in real-time but cannot reliably export the generated speech to a file. The spoken prefix needs to be embedded into each MP3 part, which requires actual audio data (WAV/PCM). Piper TTS running via ONNX Runtime Web produces WAV blobs that can be concatenated with podcast audio.

### Why Piper

- Runs entirely in-browser via WebAssembly + ONNX Runtime Web
- No network needed after the voice model is cached
- Produces 22050Hz mono WAV suitable for speech-only content
- ~17MB voice model (en_US-amy-low), cached in OPFS after first download

### Caching

| Data | Storage | Notes |
|------|---------|-------|
| Piper voice model | OPFS | Managed by piper-tts-web, persists across sessions |
| FFmpeg WASM | HTTP cache | Static files from `/ffmpeg/`, cached by browser |
| ONNX Runtime WASM | HTTP cache | Self-hosted at `/ort/` (required by COEP) |
| Generated prefix audio | IndexedDB | Keyed by text + voice + engine version |
| User settings | localStorage | Part duration, speed, bitrate preferences |

### First-load downloads

On first use, the app downloads:
- FFmpeg WASM core: ~25 MB
- ONNX Runtime WASM: ~8 MB
- Piper voice model: ~17 MB

All are cached for subsequent visits.

### Privacy

- No audio data leaves your browser
- No analytics, no tracking, no cookies
- TTS runs locally via WebAssembly
- The only network requests are for static assets on first load

## Mobile / iOS limitations

- Multi-thread FFmpeg is disabled by default (SharedArrayBuffer not reliable in iOS workers)
- Processing is sequential and conservative with memory
- Very large files (>200MB) may cause memory pressure
- Wake Lock API keeps the screen on during processing (Safari 16.4+)
- ZIP download may open inline; use "Save to Files" if needed

## Tech stack

- Vite + React + TypeScript
- @ffmpeg/ffmpeg (WebAssembly audio processing)
- @mintplex-labs/piper-tts-web (local TTS via ONNX Runtime)
- @zip.js/zip.js (streaming ZIP creation)
- music-metadata (ID3 / MP4 tag + chapter parsing)
- idb-keyval (IndexedDB caching)
- Vanilla CSS (no design library)
