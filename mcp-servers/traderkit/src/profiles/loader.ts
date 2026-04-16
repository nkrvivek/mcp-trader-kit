import { parse as parseYaml } from "yaml";
import { ProfileSchema, type Profile } from "./schema.js";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/;

export function parseProfile(raw: string): Profile {
  const m = FRONTMATTER.exec(raw);
  if (!m) throw new Error("profile: missing YAML frontmatter");
  const yaml = parseYaml(m[1]!);
  return ProfileSchema.parse(yaml);
}

export async function loadProfile(path: string): Promise<Profile> {
  const { readFile } = await import("node:fs/promises");
  return parseProfile(await readFile(path, "utf8"));
}

export async function loadAllProfiles(dir: string): Promise<Profile[]> {
  const { readdir } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".md"));
  return Promise.all(files.map((f) => loadProfile(join(dir, f))));
}
