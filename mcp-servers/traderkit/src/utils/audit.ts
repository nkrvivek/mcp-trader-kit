import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export interface AuditEntry {
  ts: string;
  profile: string;
  kind: string;
  payload: unknown;
  pass: boolean;
  reasons: string[];
  warnings: string[];
}

function auditDir(): string {
  const root = process.env.TRADERKIT_HOME ?? join(homedir(), ".traderkit");
  return join(root, "gate_audit");
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

async function readLastHash(file: string): Promise<string | null> {
  if (!existsSync(file)) return null;
  try {
    const body = await readFile(file, "utf8");
    const lines = body.trim().split("\n");
    const last = lines[lines.length - 1];
    if (!last) return null;
    const parsed = JSON.parse(last) as { hash?: string };
    return parsed.hash ?? null;
  } catch {
    return null;
  }
}

export interface AuditWriteResult {
  ticket_id: string;
  file: string;
}

export async function writeAudit(entry: AuditEntry): Promise<AuditWriteResult> {
  const day = entry.ts.slice(0, 10);
  const file = join(auditDir(), `${day}.jsonl`);
  await mkdir(dirname(file), { recursive: true });

  const prev = await readLastHash(file);
  const core = JSON.stringify({ ...entry, prev_hash: prev });
  const hash = sha256(core);
  const ticket_id = hash.slice(0, 16);
  const line = JSON.stringify({ ...entry, prev_hash: prev, hash, ticket_id }) + "\n";
  await appendFile(file, line, "utf8");
  return { ticket_id, file };
}

export function writeAuditSafe(entry: AuditEntry): Promise<AuditWriteResult | null> {
  return writeAudit(entry).catch(() => null);
}
