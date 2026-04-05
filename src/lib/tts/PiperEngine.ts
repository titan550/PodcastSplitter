import type { TTSEngine } from "./TTSEngine";
import { getCachedBlob, setCachedBlob, blobCacheKey } from "../cache/blobCache";
import { assetUrl } from "../assetUrl";

const ENGINE_VERSION = "piper-1.0.4";

export class PiperEngine implements TTSEngine {
  private voiceId: string;
  private session: import("@mintplex-labs/piper-tts-web").TtsSession | null =
    null;

  constructor(voiceId: string = "en_US-amy-low") {
    this.voiceId = voiceId;
  }

  async init(onProgress?: (pct: number) => void): Promise<void> {
    // Force single-threaded ORT. piper-tts-web's init() overrides numThreads
    // with navigator.hardwareConcurrency, which causes threaded WASM mode to
    // fail. Intercept assignments silently so it always reads as 1.
    const ort = await import("onnxruntime-web");
    // Routed through assetUrl so it still resolves under /<repo>/ on
    // GitHub Pages project deploys (COEP blocks cross-origin WASM, so
    // ORT must load from same-origin under the app's base path).
    ort.env.wasm.wasmPaths = assetUrl("/ort/");
    Object.defineProperty(ort.env.wasm, "numThreads", {
      get: () => 1,
      set: () => {
        // silently ignore — numThreads is locked to 1
      },
      configurable: true,
    });

    const { TtsSession } = await import("@mintplex-labs/piper-tts-web");

    // Create session — TtsSession handles model download and caching internally
    this.session = new TtsSession({
      voiceId: this.voiceId,
      progress: (progress: { loaded: number; total: number }) => {
        if (onProgress && progress.total > 0) {
          onProgress(Math.round((progress.loaded / progress.total) * 100));
        }
      },
      wasmPaths: {
        onnxWasm: assetUrl("/ort/"),
        piperData: assetUrl("/piper/piper_phonemize.data"),
        piperWasm: assetUrl("/piper/piper_phonemize.wasm"),
      },
    });

    // Wait for the session's init to finish before trying predict
    await this.session.waitReady;
  }

  async synthesizeToWav(text: string): Promise<Blob> {
    if (!this.session) throw new Error("PiperEngine not initialized");

    const key = blobCacheKey(text, this.voiceId, ENGINE_VERSION);
    const cached = await getCachedBlob(key);
    if (cached) return cached;

    const wavBlob = await this.session.predict(text);
    await setCachedBlob(key, wavBlob);
    return wavBlob;
  }

  async warmup(): Promise<void> {
    // init() already warms up with a test prediction
  }
}
