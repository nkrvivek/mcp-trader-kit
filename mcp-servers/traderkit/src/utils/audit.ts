import { createHash } from "node:crypto";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
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

function auditBaseRoot(): string {
  const root = process.env.TRADERKIT_HOME ?? join(homedir(), ".traderkit");
  const resolved = resolve(root);
  const allowedPrefixes = [resolve(homedir()), resolve("/tmp"), resolve("/var/folders")];
  const ok = allowedPrefixes.some((p) => resolved === p || resolved.startsWith(p + "/"));
  if (!ok) {
    throw new Error(`audit dir outside safe prefix: ${resolved} (allowed: ${allowedPrefixes.join(", ")})`);
  }
  return resolved;
}

function auditDir(): string {
  return join(auditBaseRoot(), "gate_audit");
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

interface LastLineInfo {
  prevHash: string | null;
  chainValid: boolean;
  chainError?: string;
}

async function readLastLine(file: string): Promise<LastLineInfo> {
  if (!existsSync(file)) return { prevHash: null, chainValid: true };
  try {
    const body = await readFile(file, "utf8");
    const lines = body.trim().split("\n").filter(Boolean);
    const last = lines[lines.length - 1];
    if (!last) return { prevHash: null, chainValid: true };
    const parsed = JSON.parse(last) as { hash?: string; prev_hash?: string | null; ticket_id?: string };
    const storedHash = parsed.hash;
    if (!storedHash) return { prevHash: null, chainValid: false, chainError: "last line missing hash" };
    const { hash: _h, ticket_id: _t, ...rest } = parsed as Record<string, unknown>;
    const recomputed = sha256(JSON.stringify(rest));
    if (recomputed !== storedHash) {
      return { prevHash: storedHash, chainValid: false, chainError: "last-line hash mismatch" };
    }
    return { prevHash: storedHash, chainValid: true };
  } catch (e) {
    return { prevHash: null, chainValid: false, chainError: `read/parse: ${(e as Error).message}` };
  }
}

export interface AuditWriteResult {
  ticket_id: string;
  file: string;
  chain_warning?: string;
}

export async function writeAudit(entry: AuditEntry): Promise<AuditWriteResult> {
  const day = entry.ts.slice(0, 10);
  const file = join(auditDir(), `${day}.jsonl`);
  await mkdir(dirname(file), { recursive: true });

  const last = await readLastLine(file);
  const core = JSON.stringify({ ...entry, prev_hash: last.prevHash });
  const hash = sha256(core);
  const ticket_id = hash.slice(0, 16);
  const line = JSON.stringify({ ...entry, prev_hash: last.prevHash, hash, ticket_id }) + "\n";
  await appendFile(file, line, "utf8");
  const result: AuditWriteResult = { ticket_id, file };
  if (!last.chainValid && last.chainError) result.chain_warning = last.chainError;
  return result;
}

export function writeAuditSafe(entry: AuditEntry): Promise<AuditWriteResult | null> {
  return writeAudit(entry).catch((e: Error) => {
    process.stderr.write(`[traderkit audit] write failed: ${e.message}\n`);
    return null;
  });
}
