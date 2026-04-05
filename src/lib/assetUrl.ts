// Resolves a /public asset path against Vite's BASE_URL. BASE_URL must
// be an absolute path string ("/" or "/repo/") — vite.config.ts sets it
// from an env var, never "./". Absolute paths reset the URL path
// component in `new URL()`, so this works uniformly whether called from
// the main thread (self.location.href === document URL) or a web worker
// (self.location.href === worker script URL under /assets/).
const BASE = import.meta.env.BASE_URL;

export function assetUrl(path: string): string {
  const trimmed = path.replace(/^\//, "");
  return new URL(BASE + trimmed, self.location.href).href;
}
