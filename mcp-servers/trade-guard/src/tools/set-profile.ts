import { z } from "zod";
import { setActiveProfile } from "../profiles/session.js";
import { KIT_ROOT } from "../config.js";
import type { Profile } from "../profiles/schema.js";

export const SetProfileArgs = z.object({ name: z.string().min(1) });

export async function setProfileHandler(raw: unknown, deps: { allProfiles: Profile[] }) {
  const { name } = SetProfileArgs.parse(raw);
  if (!deps.allProfiles.some((p) => p.name === name)) {
    throw new Error(`unknown profile: ${name}`);
  }
  await setActiveProfile(KIT_ROOT, name);
  return { active_profile: name };
}
