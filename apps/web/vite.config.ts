import { defineConfig } from "vite";
import { execSync } from "node:child_process";

/** The build number is the number of commits, so every pushed change is a new version (see src/version.ts). */
const git = (cmd: string, fallback: string) => { try { return execSync(`git ${cmd}`, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim() || fallback; } catch { return fallback; } };

export default defineConfig({
  base: "./", server: { port: 5180, host: true }, build: { target: "es2022" },
  define: {
    __BUILD_COUNT__: JSON.stringify(Number(process.env.BUILD_COUNT ?? git("rev-list --count HEAD", "0"))),
    __BUILD_SHA__: JSON.stringify(git("rev-parse --short HEAD", "")),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString()),
  },
});
