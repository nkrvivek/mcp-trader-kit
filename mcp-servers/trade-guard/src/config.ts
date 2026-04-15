import { join } from "node:path";
import { homedir } from "node:os";

export const KIT_ROOT = process.env.MCP_TRADER_KIT_ROOT ?? join(homedir(), ".mcp-trader-kit");
export const PROFILES_DIR = join(KIT_ROOT, "profiles");
export const SESSION_FILE = ".session.json";
export const ACTIVITIES_CACHE_TTL_MS = 5 * 60 * 1000;
