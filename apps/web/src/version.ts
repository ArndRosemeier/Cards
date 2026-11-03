declare const __BUILD_COUNT__: number, __BUILD_SHA__: string, __BUILD_DATE__: string;

/**
 * Version = 1.00 at commit BASE, and +0.01 for every commit after it (1.99 is followed by 2.00). The number comes from
 * `git rev-list --count HEAD` at build time, so the publisher's build needs the full git history (no shallow clone).
 */
export const BASE_COMMIT = 76;
const n = typeof __BUILD_COUNT__ === "number" && __BUILD_COUNT__ > 0 ? Math.max(0, __BUILD_COUNT__ - BASE_COMMIT) : 0;
export const VERSION = `${1 + Math.floor(n / 100)}.${String(n % 100).padStart(2, "0")}`;
export const BUILD_SHA = typeof __BUILD_SHA__ === "string" ? __BUILD_SHA__ : "";
export const BUILD_DATE = typeof __BUILD_DATE__ === "string" ? new Date(__BUILD_DATE__) : new Date();
export const versionNum = (v: string) => Number(v);
