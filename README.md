# Podcast Splitter

A static web app that splits podcast MP3 files into labeled, speed-adjusted parts for screenless swimming headphones. All processing runs locally in your browser.

## What it does

1. Upload one MP3 file
2. App splits it into smaller parts (default 5 minutes each)
3. Prepends a spoken label to each part: "Part N of {Podcast Title}"
4. Speeds up podcast content (default 1.25x, prefix stays at normal speed)
5. Exports all parts as MP3s in one ZIP download

## Local development

```bash
npm install
npm run dev
```

The dev server sets `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp` headers. Verify `crossOriginIsolated === true` in your browser console.

## Build

```bash
npm run build
```

Output goes to `dist/`.

## Tests

```bash
npm test           # single run
npm run test:watch # watch mode
```

## Deploy to Cloudflare Pages

1. Connect your repo to Cloudflare Pages
2. Build command: `npm run build`
3. Build output directory: `dist`
4. The `public/_headers` file provides the required COOP/COEP headers

No Pages Functions are used. Static hosting only.

## Architecture

### Why static-only

- Cloudflare Pages free plan: unlimited static asset requests, zero compute cost
- All audio processing runs in-browser via WebAssembly
- No account system, no database, no server-side state

### Why not browser speechSynthesis

The Web Speech API (`speechSynthesis`) can play audio in real-time but cannot reliably export the generated speech to a file. The spoken prefix needs to be embedded into each MP3 part, which requires actual audio data (WAV/PCM). Piper TTS running via ONNX Runtime Web produces WAV blobs that can be concatenated with podcast audio.

### Why Piper is the default TTS

- Runs entirely in-browser via WebAssembly + ONNX Runtime Web
- No network needed after the voice model is cached
- Produces 22050Hz mono WAV suitable for speech-only content
- ~17MB voice model (en_US-amy-low), cached in OPFS after first download

### Why Kokoro is experimental

Kokoro TTS is not yet stable in browser environments. It is behind an experimental toggle and not recommended for production use.

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

## iPhone Safari limitations

- Multi-thread FFmpeg is disabled (SharedArrayBuffer not reliable in iOS workers)
- Processing is sequential and conservative with memory
- Very large files (>200MB) may cause memory pressure
- Wake Lock API keeps the screen on during processing (Safari 16.4+)
- ZIP download may open inline; use "Save to Files" if needed

## Tech stack

- Vite + React + TypeScript
- @ffmpeg/ffmpeg (WebAssembly audio processing)
- @mintplex-labs/piper-tts-web (local TTS via ONNX Runtime)
- @zip.js/zip.js (streaming ZIP creation)
- music-metadata (ID3 tag parsing)
- idb-keyval (IndexedDB caching)
- Vanilla CSS (no design library)

## Future enhancements

- Kokoro TTS integration
- Multi-thread FFmpeg on supporting browsers
- ID3 tag writing on output MP3s
- Resume interrupted jobs
- Service worker for offline support
