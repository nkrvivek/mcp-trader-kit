import { describe, expect, it } from "vitest";
import { redact } from "../src/redact.js";

describe("redact", () => {
  it("scrubs any secret substring from a string", () => {
    const out = redact("error: USER_SECRET=deadbeef failed", ["deadbeef", "abc123"]);
    expect(out).toBe("error: USER_SECRET=<REDACTED> failed");
  });

  it("scrubs recursively in objects", () => {
    const r = redact({ a: "key=deadbeef", b: { c: ["deadbeef"] } }, ["deadbeef"]) as any;
    expect(r.a).toContain("<REDACTED>");
    expect(r.b.c[0]).toBe("<REDACTED>");
  });

  it("ignores empty/short secrets (<8 chars)", () => {
    const out = redact("foo bar", ["ab", ""]);
    expect(out).toBe("foo bar");
  });

  it("leaves non-string non-object inputs unchanged", () => {
    expect(redact(42, ["deadbeef"])).toBe(42);
    expect(redact(null, ["deadbeef"])).toBeNull();
  });
});
