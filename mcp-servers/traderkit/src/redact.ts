const MIN = 8;
const TOKEN = "<REDACTED>";

export function redact(value: unknown, secrets: string[]): unknown {
  const real = secrets.filter((s) => s && s.length >= MIN);
  if (real.length === 0) return value;
  return walk(value, real);
}

function walk(v: unknown, secrets: string[]): unknown {
  if (typeof v === "string") {
    let out = v;
    for (const s of secrets) out = out.split(s).join(TOKEN);
    return out;
  }
  if (Array.isArray(v)) return v.map((x) => walk(x, secrets));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = walk(val, secrets);
    return out;
  }
  return v;
}
