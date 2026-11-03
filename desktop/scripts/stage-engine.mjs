import { cpSync, copyFileSync, mkdirSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const out = join(root, "desktop", "src-tauri", "engine");

// The installer ships the engine's Python source. __pycache__ is just clutter, so it stays behind.
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, "digger"), join(out, "digger"), {
  recursive: true,
  filter: (src) => basename(src) !== "__pycache__" && !src.endsWith(".pyc"),
});
copyFileSync(join(root, "requirements.txt"), join(out, "requirements.txt"));
console.log(`staged the engine in ${out}`);
