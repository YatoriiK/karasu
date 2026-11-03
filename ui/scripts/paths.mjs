import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Works out the repo root from where this file lives, so the scripts don't care where you cloned it.
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..").replaceAll("\\", "/");
export const SHOTS = process.env.KARASU_SHOTS || `${ROOT}/cache/shots`;
