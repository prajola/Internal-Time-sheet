/**
 * Where the app is mounted.
 *
 * Production serves it from https://kubegraf.io/timesheet rather than a
 * domain root, so nothing may assume "/" is the app root. `BASE_URL` is
 * injected by Vite from the `base` option in vite.config.ts — that file
 * is the single place the path is configured.
 *
 * Use these helpers instead of writing absolute "/..." strings:
 *   - wouter `<Link href>` and `navigate()` are already base-aware via
 *     `<Router base>`, so keep passing them plain app paths.
 *   - Raw `<a href>`, `window.location`, and anything pointing at a
 *     file in public/ must go through `withBase` / `asset`.
 */

/** e.g. "/timesheet" — no trailing slash, so `${BASE_PATH}/login` reads naturally. */
export const BASE_PATH = import.meta.env.BASE_URL.replace(/\/$/, "");

/** Absolute URL for an app route: withBase("/login") → "/timesheet/login". */
export function withBase(path: string): string {
  return `${BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Absolute URL for a file in public/: asset("kubegraf-logo.png"). */
export function asset(file: string): string {
  return `${import.meta.env.BASE_URL}${file.replace(/^\//, "")}`;
}

/**
 * Strip the mount path off a browser pathname, so route comparisons can
 * be written against plain app paths. "/timesheet/login" → "/login".
 */
export function stripBase(pathname: string): string {
  if (BASE_PATH && pathname.startsWith(BASE_PATH)) {
    return pathname.slice(BASE_PATH.length) || "/";
  }
  return pathname;
}
