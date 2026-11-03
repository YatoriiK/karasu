import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..").replaceAll("\\", "/");
export const SHOTS = process.env.CD_SHOTS || `${ROOT}/cache/shots`;
