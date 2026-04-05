/*
 * Cross-Origin Isolation service worker.
 *
 * Enables `crossOriginIsolated === true` (and therefore SharedArrayBuffer +
 * multi-thread WebAssembly) on hosts that can't send COOP/COEP headers
 * themselves — notably GitHub Pages. Intercepts every navigation/document
 * fetch and re-responds with:
 *
 *   Cross-Origin-Opener-Policy: same-origin
 *   Cross-Origin-Embedder-Policy: require-corp
 *
 * plus a Cross-Origin-Resource-Policy on same-origin resources so the
 * cross-origin checks pass.
 *
 * On hosts that already send the headers (Cloudflare Pages via _headers),
 * this SW is redundant but harmless — the browser honors the stricter of
 * the two sets.
 *
 * Adapted from the well-known coi-serviceworker pattern. No external
 * dependency; kept small and self-contained.
 */

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.cache === "only-if-cached" && req.mode !== "same-origin") return;

  // Only rewrite same-origin responses. Cross-origin requests stay on
  // the default fetch path so the browser's streaming optimizations
  // aren't disabled and the SW doesn't become a pointless middleman.
  // Header rewriting wouldn't help a cross-origin resource anyway —
  // the browser enforces CORP on the original response regardless.
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(req).then((response) => {
      const headers = new Headers(response.headers);
      headers.set("Cross-Origin-Opener-Policy", "same-origin");
      headers.set("Cross-Origin-Embedder-Policy", "require-corp");
      headers.set("Cross-Origin-Resource-Policy", "same-origin");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    }),
  );
});
