import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Absolute base URL, driven by env var so one config serves both deploys:
//  - Cloudflare root deploy: unset → "/"
//  - GitHub Pages project page: set to "/<repo-name>/" by pages.yml
//
// Must be absolute (not "./") so `new URL(BASE + path, self.location.href)`
// resolves correctly inside web workers, where self.location.href is the
// worker script URL under /assets/ rather than the document URL.
export default defineConfig({
  base: process.env.VITE_BASE_URL || "/",
  plugins: [react()],
  optimizeDeps: {
    exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"],
  },
  server: {
    headers: {
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Embedder-Policy": "require-corp",
    },
  },
  build: {
    target: "es2022",
  },
  worker: {
    format: "es",
  },
});
