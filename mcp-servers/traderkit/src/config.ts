import { join } from "node:path";
import { homedir } from "node:os";

export const KIT_ROOT = process.env.TRADERKIT_ROOT ?? join(homedir(), ".traderkit");
export const PROFILES_DIR = join(KIT_ROOT, "profiles");
export const SESSION_FILE = ".session.json";
export const ACTIVITIES_CACHE_TTL_MS = 5 * 60 * 1000;
