import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { join, dirname } from "node:path";
import { z } from "zod";
import { SESSION_FILE } from "../config.js";

const NAME_RE = /^[a-z0-9-]+$/;
const Session = z.object({ active_profile: z.string().regex(NAME_RE).nullable() });

function path(root: string) { return join(root, SESSION_FILE); }

export async function getActiveProfile(root: string): Promise<string | null> {
  try {
    const raw = await readFile(path(root), "utf8");
    return Session.parse(JSON.parse(raw)).active_profile;
  } catch (e: any) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

export async function setActiveProfile(root: string, name: string): Promise<void> {
  if (!NAME_RE.test(name)) throw new Error(`profile name must be lowercase-kebab: ${name}`);
  await mkdir(dirname(path(root)), { recursive: true });
  await writeFile(path(root), JSON.stringify({ active_profile: name }), { mode: 0o600 });
}

export async function clearActiveProfile(root: string): Promise<void> {
  try { await unlink(path(root)); }
  catch (e: any) { if (e.code !== "ENOENT") throw e; }
}
