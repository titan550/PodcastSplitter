import { cpSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";

// ffmpeg single-thread core
const ffmpegDir = "public/ffmpeg";
mkdirSync(ffmpegDir, { recursive: true });
const ffmpegSrc = "node_modules/@ffmpeg/core/dist/esm";
for (const f of ["ffmpeg-core.js", "ffmpeg-core.wasm"]) {
  cpSync(join(ffmpegSrc, f), join(ffmpegDir, f));
}
console.log("Copied ffmpeg single-thread core to public/ffmpeg/");

// ONNX Runtime WASM files (must be self-hosted for COEP compliance)
const ortDir = "public/ort";
mkdirSync(ortDir, { recursive: true });
const ortSrc = "node_modules/onnxruntime-web/dist";
const ortFiles = readdirSync(ortSrc).filter((f) => f.endsWith(".wasm"));
for (const f of ortFiles) {
  cpSync(join(ortSrc, f), join(ortDir, f));
}
console.log(`Copied ${ortFiles.length} ORT WASM files to public/ort/`);

// piper-phonemize WASM + data (self-hosted to avoid COEP re-validation
// on every TTS call; piper-tts-web creates a new Emscripten module per
// predict() call and under COEP the browser re-fetches cross-origin
// resources even when cached)
const piperDir = "public/piper";
mkdirSync(piperDir, { recursive: true });
const piperSrc = "node_modules/@diffusionstudio/piper-wasm/build";
for (const f of ["piper_phonemize.wasm", "piper_phonemize.data"]) {
  cpSync(join(piperSrc, f), join(piperDir, f));
}
console.log("Copied piper-phonemize WASM to public/piper/");
