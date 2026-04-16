import { afterEach, describe, expect, it, beforeEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getActiveProfile, setActiveProfile, clearActiveProfile } from "../../src/profiles/session.js";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "traderkit-test-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

describe("session profile state", () => {
  it("returns null when no session file", async () => {
    expect(await getActiveProfile(root)).toBeNull();
  });

  it("round-trips set/get", async () => {
    await setActiveProfile(root, "bildof");
    expect(await getActiveProfile(root)).toBe("bildof");
    const raw = await readFile(join(root, ".session.json"), "utf8");
    expect(JSON.parse(raw).active_profile).toBe("bildof");
  });

  it("clear removes profile", async () => {
    await setActiveProfile(root, "bildof");
    await clearActiveProfile(root);
    expect(await getActiveProfile(root)).toBeNull();
  });

  it("rejects invalid profile name shape", async () => {
    await expect(setActiveProfile(root, "Bad Name!")).rejects.toThrow(/profile name/);
  });
});
