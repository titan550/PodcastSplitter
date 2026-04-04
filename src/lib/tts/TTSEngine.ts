export interface TTSEngine {
  init(onProgress?: (pct: number) => void): Promise<void>;
  synthesizeToWav(text: string): Promise<Blob>;
  warmup(): Promise<void>;
}
