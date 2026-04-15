# mcp-trader-kit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a cloneable OSS setup pack that gives other traders the author's Claude-Code-as-trading-terminal workflow (gated trade execution, Obsidian-style vault, wash-sale aware, multi-profile) via one `./setup.sh` run.

**Architecture:** Node 20 / TypeScript monorepo. Two publishable artifacts: (1) `mcp-trader-kit` GH repo — setup scripts + templates + docs; (2) `trade-guard-mcp` npm package — MCP server enforcing risk gates via PreToolUse hook. trade-guard-mcp spawns a sibling snaptrade-mcp-ts client on demand for wash-sale activity lookups.

**Tech Stack:** Node 20, TypeScript 5, `@modelcontextprotocol/sdk`, `zod` v4, `yaml`, `vitest` + `@vitest/coverage-v8`, `msw` for MCP mocking, bash for setup/doctor scripts.

**Spec:** `/Users/Vivek/Development/mcp-trader-kit/docs/superpowers/specs/2026-04-14-mcp-trader-kit-design.md`

---

## File Structure

```
mcp-trader-kit/
├── package.json                            # workspace root
├── tsconfig.base.json
├── .gitignore
├── .github/workflows/ci.yml
├── README.md                               # public-facing entry
├── SETUP.md                                # install walkthrough
├── LICENSE                                 # MIT
├── mcp-servers/trade-guard/
│   ├── package.json                        # npm-publishable: trade-guard-mcp
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   ├── src/
│   │   ├── index.ts                        # stdio MCP server entry
│   │   ├── config.ts                       # paths + env
│   │   ├── redact.ts                       # cred scrubbing
│   │   ├── cache.ts                        # 5-min TTL
│   │   ├── profiles/
│   │   │   ├── schema.ts                   # zod profile shape
│   │   │   ├── loader.ts                   # read YAML-frontmatter md
│   │   │   └── session.ts                  # active-profile session file
│   │   ├── gates/
│   │   │   ├── caps.ts                     # pure fn: caps check
│   │   │   ├── wash-sale.ts                # ±30d cross-account
│   │   │   └── compose.ts                  # check_trade composition
│   │   ├── mcp/
│   │   │   └── snaptrade-read-client.ts    # sibling MCP client
│   │   └── tools/
│   │       ├── check-trade.ts
│   │       ├── check-wash-sale.ts
│   │       ├── scan-tlh.ts
│   │       ├── list-profiles.ts
│   │       └── set-profile.ts
│   └── test/
│       ├── profiles/loader.test.ts
│       ├── profiles/session.test.ts
│       ├── gates/caps.test.ts
│       ├── gates/wash-sale.test.ts
│       ├── tools/scan-tlh.test.ts
│       ├── redact.test.ts
│       └── integration/mcp.test.ts
├── scripts/
│   ├── setup.sh                            # interactive installer
│   ├── doctor.sh                           # health check
│   ├── refresh.sh                          # portfolio chain
│   └── pre-tool-use.js                     # Claude Code hook script
├── templates/
│   ├── CLAUDE.md                           # auto-load + proposal + auto-persist
│   ├── claude-settings.json                # MCP regs + hook wiring
│   ├── profiles/
│   │   ├── example-personal.md
│   │   └── example-llc.md
│   └── vault/wiki/trading/
│       ├── dashboard.md
│       ├── regime.md
│       ├── risk-signals.md
│       ├── portfolio-master.md
│       ├── open-questions.md
│       ├── theses/index.md
│       ├── trades/.gitkeep
│       ├── sessions/.gitkeep
│       └── scanner-signals.md
├── docs/
│   ├── brokerages.md
│   ├── unusual-whales.md
│   ├── tradestation.md
│   ├── exa.md
│   ├── tax-entity.md
│   ├── risk-gates.md
│   └── proposal-ux.md
└── examples/
    ├── bildof-sample-session.md
    ├── tlh-walkthrough.md
    └── regime-check.md
```

**Decomposition notes:**
- `gates/` pure functions with no side effects except wash-sale (which makes one MCP-client call). Caps and compose are pure.
- `mcp/snaptrade-read-client.ts` is the only place that spawns a sibling MCP. All other tool logic consumes its cached output.
- Each tool file is a thin adapter: parse zod-validated args → call corresponding gate/scanner → format MCP response.
- `session.ts` is the only thing that touches `~/.mcp-trader-kit/.session.json` — single writer, easy to test.

---

## Task 1: Scaffold monorepo + CI

**Files:**
- Create: `mcp-trader-kit/package.json`
- Create: `mcp-trader-kit/tsconfig.base.json`
- Create: `mcp-trader-kit/.gitignore`
- Create: `mcp-trader-kit/.github/workflows/ci.yml`
- Create: `mcp-trader-kit/LICENSE`

- [ ] **Step 1: Create root `package.json` with npm workspaces**

```json
{
  "name": "mcp-trader-kit",
  "version": "0.0.0",
  "private": true,
  "description": "Packaged Claude-Code-as-trading-terminal setup with risk-gated MCP trading.",
  "license": "MIT",
  "engines": { "node": ">=20" },
  "workspaces": ["mcp-servers/*"],
  "scripts": {
    "build": "npm run -ws build",
    "test": "npm run -ws test",
    "typecheck": "npm run -ws typecheck"
  }
}
```

- [ ] **Step 2: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": false
  }
}
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
dist/
coverage/
.env
.env.local
*.log
.DS_Store
.mcp-trader-kit/
```

- [ ] **Step 4: Create `LICENSE` (MIT)**

Standard MIT text with `Copyright (c) 2026 Vivek Nair`.

- [ ] **Step 5: Create `.github/workflows/ci.yml`**

```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run test
      - run: npm run build
```

- [ ] **Step 6: Commit**

```bash
cd /Users/Vivek/Development/mcp-trader-kit
git init -b main
git add .
git commit -m "chore: scaffold monorepo with npm workspaces + CI"
```

---

## Task 2: Scaffold `trade-guard-mcp` package

**Files:**
- Create: `mcp-servers/trade-guard/package.json`
- Create: `mcp-servers/trade-guard/tsconfig.json`
- Create: `mcp-servers/trade-guard/vitest.config.ts`
- Create: `mcp-servers/trade-guard/src/index.ts` (stub)

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "trade-guard-mcp",
  "version": "0.1.0",
  "description": "Risk gate MCP for trading — caps, wash-sale, TLH.",
  "license": "MIT",
  "type": "module",
  "engines": { "node": ">=20" },
  "bin": { "trade-guard-mcp": "dist/index.js" },
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "files": ["dist"],
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run --coverage",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.0.0",
    "yaml": "^2.5.0",
    "zod": "^4.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@vitest/coverage-v8": "^2.0.0",
    "typescript": "^5.6.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 75 },
      include: ["src/**"],
    },
  },
});
```

- [ ] **Step 4: Create stub `src/index.ts`**

```ts
#!/usr/bin/env node
console.error("trade-guard-mcp: not yet implemented");
process.exit(1);
```

- [ ] **Step 5: Install deps**

Run: `cd /Users/Vivek/Development/mcp-trader-kit && npm install`
Expected: no errors; `node_modules/` + `package-lock.json` appear.

- [ ] **Step 6: Verify build works**

Run: `npm run -w trade-guard-mcp build`
Expected: `dist/index.js` created, no TS errors.

- [ ] **Step 7: Commit**

```bash
git add .
git commit -m "feat(trade-guard): scaffold MCP package with vitest + TS"
```

---

## Task 3: Profile schema + loader (TDD)

**Files:**
- Create: `mcp-servers/trade-guard/src/profiles/schema.ts`
- Create: `mcp-servers/trade-guard/src/profiles/loader.ts`
- Create: `mcp-servers/trade-guard/test/profiles/loader.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/profiles/loader.test.ts
import { describe, expect, it } from "vitest";
import { parseProfile } from "../../src/profiles/loader.js";

const VALID = `---
name: bildof
broker: snaptrade
account_id: 11111111-1111-1111-1111-111111111111
tax_entity: llc-bildof
caps:
  max_order_notional: 5000
  max_single_name_pct: 10
  forbidden_tools: []
  forbidden_leg_shapes: [naked_put]
vault_link: bildof/log.md
---

# Bildof profile
Notes...
`;

describe("parseProfile", () => {
  it("parses a valid profile", () => {
    const p = parseProfile(VALID);
    expect(p.name).toBe("bildof");
    expect(p.caps.max_order_notional).toBe(5000);
    expect(p.caps.forbidden_leg_shapes).toContain("naked_put");
    expect(p.tax_entity).toBe("llc-bildof");
  });

  it("rejects missing required field", () => {
    const bad = VALID.replace("name: bildof\n", "");
    expect(() => parseProfile(bad)).toThrow(/name/);
  });

  it("rejects unknown tax_entity", () => {
    const bad = VALID.replace("tax_entity: llc-bildof", "tax_entity: offshore");
    expect(() => parseProfile(bad)).toThrow(/tax_entity/);
  });

  it("rejects non-UUID account_id", () => {
    const bad = VALID.replace(/account_id: .+/, "account_id: not-a-uuid");
    expect(() => parseProfile(bad)).toThrow(/account_id/);
  });

  it("defaults forbidden_tools to empty array", () => {
    const min = `---
name: x
broker: snaptrade
account_id: 11111111-1111-1111-1111-111111111111
tax_entity: personal
caps: { max_order_notional: 1000, max_single_name_pct: 25 }
---
body`;
    const p = parseProfile(min);
    expect(p.caps.forbidden_tools).toEqual([]);
    expect(p.caps.forbidden_leg_shapes).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npm run -w trade-guard-mcp test -- profiles/loader`
Expected: FAIL — `parseProfile` not exported.

- [ ] **Step 3: Implement schema**

```ts
// src/profiles/schema.ts
import { z } from "zod";

export const TaxEntity = z.enum(["personal", "llc-bildof", "llc-innocore"]);
export type TaxEntity = z.infer<typeof TaxEntity>;

export const Broker = z.enum(["snaptrade", "tradestation", "ibkr-direct"]);
export type Broker = z.infer<typeof Broker>;

export const LegShape = z.enum(["naked_put", "naked_call", "naked_straddle", "naked_strangle"]);

export const ProfileSchema = z.object({
  name: z.string().min(1).max(50).regex(/^[a-z0-9-]+$/, "lowercase-kebab"),
  broker: Broker,
  account_id: z.uuid(),
  tax_entity: TaxEntity,
  caps: z.object({
    max_order_notional: z.number().nonnegative(),
    max_single_name_pct: z.number().min(0).max(100),
    forbidden_tools: z.array(z.string()).default([]),
    forbidden_leg_shapes: z.array(LegShape).default([]),
  }),
  vault_link: z.string().optional(),
});
export type Profile = z.infer<typeof ProfileSchema>;
```

- [ ] **Step 4: Implement loader**

```ts
// src/profiles/loader.ts
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
```

- [ ] **Step 5: Run — expect pass**

Run: `npm run -w trade-guard-mcp test -- profiles/loader`
Expected: 5 PASS.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat(trade-guard): profile schema + YAML-frontmatter loader"
```

---

## Task 4: Session profile state (TDD)

**Files:**
- Create: `mcp-servers/trade-guard/src/profiles/session.ts`
- Create: `mcp-servers/trade-guard/test/profiles/session.test.ts`
- Create: `mcp-servers/trade-guard/src/config.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/profiles/session.test.ts
import { afterEach, describe, expect, it, beforeEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getActiveProfile, setActiveProfile, clearActiveProfile } from "../../src/profiles/session.js";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "trade-guard-test-")); });
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
```

- [ ] **Step 2: Run — expect fail**

Run: `npm run -w trade-guard-mcp test -- profiles/session`
Expected: FAIL.

- [ ] **Step 3: Create `src/config.ts`**

```ts
// src/config.ts
import { join } from "node:path";
import { homedir } from "node:os";

export const KIT_ROOT = process.env.MCP_TRADER_KIT_ROOT ?? join(homedir(), ".mcp-trader-kit");
export const PROFILES_DIR = join(KIT_ROOT, "profiles");
export const SESSION_FILE = ".session.json";
export const ACTIVITIES_CACHE_TTL_MS = 5 * 60 * 1000;
```

- [ ] **Step 4: Implement session**

```ts
// src/profiles/session.ts
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
```

- [ ] **Step 5: Run — expect pass**

Run: `npm run -w trade-guard-mcp test -- profiles/session`
Expected: 4 PASS.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat(trade-guard): session active-profile state"
```

---

## Task 5: Caps gate (TDD)

**Files:**
- Create: `mcp-servers/trade-guard/src/gates/caps.ts`
- Create: `mcp-servers/trade-guard/test/gates/caps.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/gates/caps.test.ts
import { describe, expect, it } from "vitest";
import { checkCaps, type TradeProposal } from "../../src/gates/caps.js";
import type { Profile } from "../../src/profiles/schema.js";

const BILDOF: Profile = {
  name: "bildof", broker: "snaptrade",
  account_id: "11111111-1111-1111-1111-111111111111",
  tax_entity: "llc-bildof",
  caps: { max_order_notional: 5000, max_single_name_pct: 10, forbidden_tools: [], forbidden_leg_shapes: ["naked_put"] },
};

const TRADE: TradeProposal = {
  tool: "mleg_place",
  ticker: "AAPL",
  direction: "SELL_TO_OPEN",
  qty: 1,
  notional_usd: 3000,
  leg_shape: "covered_call",
  portfolio_total_usd: 100000,
  existing_ticker_exposure_usd: 0,
};

describe("checkCaps", () => {
  it("passes when under all caps", () => {
    expect(checkCaps(BILDOF, TRADE)).toEqual({ pass: true, reasons: [], warnings: [] });
  });

  it("rejects when notional exceeds cap", () => {
    const r = checkCaps(BILDOF, { ...TRADE, notional_usd: 6000 });
    expect(r.pass).toBe(false);
    expect(r.reasons[0]).toMatch(/notional \$6,000 > cap \$5,000/);
  });

  it("rejects when post-trade single-name pct exceeds cap", () => {
    const r = checkCaps(BILDOF, { ...TRADE, existing_ticker_exposure_usd: 9000, notional_usd: 2000 });
    expect(r.pass).toBe(false);
    expect(r.reasons.some((x) => /single-name/.test(x))).toBe(true);
  });

  it("rejects when tool is forbidden", () => {
    const p = { ...BILDOF, caps: { ...BILDOF.caps, forbidden_tools: ["mleg_place"] } };
    const r = checkCaps(p, TRADE);
    expect(r.pass).toBe(false);
    expect(r.reasons[0]).toMatch(/forbidden tool/);
  });

  it("rejects when leg shape is forbidden", () => {
    const r = checkCaps(BILDOF, { ...TRADE, leg_shape: "naked_put" });
    expect(r.pass).toBe(false);
    expect(r.reasons[0]).toMatch(/naked_put/);
  });

  it("accumulates multiple failures", () => {
    const r = checkCaps(BILDOF, { ...TRADE, notional_usd: 6000, leg_shape: "naked_put" });
    expect(r.pass).toBe(false);
    expect(r.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it("passes when no portfolio total provided (skips concentration)", () => {
    const r = checkCaps(BILDOF, { ...TRADE, portfolio_total_usd: 0 });
    expect(r.pass).toBe(true);
    expect(r.warnings[0]).toMatch(/portfolio total missing/);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npm run -w trade-guard-mcp test -- gates/caps`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/gates/caps.ts
import type { Profile } from "../profiles/schema.js";

export interface TradeProposal {
  tool: string;
  ticker: string;
  direction: "BUY" | "SELL" | "BUY_TO_OPEN" | "BUY_TO_CLOSE" | "SELL_TO_OPEN" | "SELL_TO_CLOSE";
  qty: number;
  notional_usd: number;
  leg_shape?: string;
  portfolio_total_usd: number;
  existing_ticker_exposure_usd: number;
}

export interface GateResult {
  pass: boolean;
  reasons: string[];
  warnings: string[];
}

const fmt = (n: number) =>
  `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;

export function checkCaps(profile: Profile, trade: TradeProposal): GateResult {
  const reasons: string[] = [];
  const warnings: string[] = [];

  if (profile.caps.forbidden_tools.includes(trade.tool)) {
    reasons.push(`forbidden tool for profile ${profile.name}: ${trade.tool}`);
  }
  if (trade.leg_shape && profile.caps.forbidden_leg_shapes.includes(trade.leg_shape as any)) {
    reasons.push(`forbidden leg shape: ${trade.leg_shape}`);
  }
  if (trade.notional_usd > profile.caps.max_order_notional) {
    reasons.push(
      `notional ${fmt(trade.notional_usd)} > cap ${fmt(profile.caps.max_order_notional)}`
    );
  }
  if (trade.portfolio_total_usd > 0) {
    const post = trade.existing_ticker_exposure_usd + Math.max(0, trade.notional_usd);
    const pct = (post / trade.portfolio_total_usd) * 100;
    if (pct > profile.caps.max_single_name_pct) {
      reasons.push(
        `post-trade single-name ${trade.ticker} = ${pct.toFixed(1)}% > cap ${profile.caps.max_single_name_pct}%`
      );
    }
  } else {
    warnings.push("portfolio total missing — single-name concentration check skipped");
  }

  return { pass: reasons.length === 0, reasons, warnings };
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npm run -w trade-guard-mcp test -- gates/caps`
Expected: 7 PASS.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat(trade-guard): caps gate (notional, concentration, forbidden tools/legs)"
```

---

## Task 6: Snaptrade-read MCP client wrapper

**Files:**
- Create: `mcp-servers/trade-guard/src/mcp/snaptrade-read-client.ts`
- Create: `mcp-servers/trade-guard/src/cache.ts`

> This module is intentionally thin. Wash-sale logic (Task 7) is unit-tested with mocked activities; this wrapper is validated via the integration test in Task 12.

- [ ] **Step 1: Implement cache**

```ts
// src/cache.ts
export interface CacheEntry<T> { value: T; expires: number; }

export class TtlCache<T> {
  private store = new Map<string, CacheEntry<T>>();
  constructor(private readonly ttlMs: number) {}
  get(key: string): T | null {
    const e = this.store.get(key);
    if (!e) return null;
    if (Date.now() > e.expires) { this.store.delete(key); return null; }
    return e.value;
  }
  set(key: string, value: T): void {
    this.store.set(key, { value, expires: Date.now() + this.ttlMs });
  }
  clear(): void { this.store.clear(); }
}
```

- [ ] **Step 2: Implement client wrapper**

```ts
// src/mcp/snaptrade-read-client.ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { TtlCache } from "../cache.js";
import { ACTIVITIES_CACHE_TTL_MS } from "../config.js";

export interface Activity {
  symbol: string;
  underlying_symbol?: string;
  action: "BUY" | "SELL";
  quantity: number;
  price: number;
  realized_pnl?: number;
  trade_date: string;
  account_id: string;
}

export interface SnaptradeReadClient {
  getActivities(accountIds: string[], since: Date): Promise<Activity[]>;
  close(): Promise<void>;
}

export interface ClientDeps {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export async function connectSnaptradeRead(deps: ClientDeps): Promise<SnaptradeReadClient> {
  const transport = new StdioClientTransport({ command: deps.command, args: deps.args, env: deps.env });
  const client = new Client({ name: "trade-guard", version: "0.1.0" }, { capabilities: {} });
  await client.connect(transport);
  const cache = new TtlCache<Activity[]>(ACTIVITIES_CACHE_TTL_MS);

  return {
    async getActivities(accountIds, since) {
      const key = `${accountIds.sort().join(",")}|${since.toISOString()}`;
      const cached = cache.get(key);
      if (cached) return cached;
      const result = await client.callTool({
        name: "snaptrade_get_activities",
        arguments: { account_ids: accountIds, start_date: since.toISOString().slice(0, 10) },
      });
      const rows = extractActivities(result);
      cache.set(key, rows);
      return rows;
    },
    async close() { await client.close(); },
  };
}

function extractActivities(result: unknown): Activity[] {
  const content = (result as any)?.content ?? [];
  const textBlock = content.find((b: any) => b.type === "text");
  if (!textBlock) return [];
  try {
    const parsed = JSON.parse(textBlock.text);
    if (Array.isArray(parsed)) return parsed as Activity[];
    if (Array.isArray(parsed.activities)) return parsed.activities as Activity[];
    return [];
  } catch { return []; }
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run -w trade-guard-mcp typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat(trade-guard): snaptrade-read sibling MCP client with TTL cache"
```

---

## Task 7: Wash-sale gate (TDD)

**Files:**
- Create: `mcp-servers/trade-guard/src/gates/wash-sale.ts`
- Create: `mcp-servers/trade-guard/test/gates/wash-sale.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/gates/wash-sale.test.ts
import { describe, expect, it } from "vitest";
import { checkWashSale, type WashSaleContext } from "../../src/gates/wash-sale.js";
import type { Profile } from "../../src/profiles/schema.js";
import type { Activity } from "../../src/mcp/snaptrade-read-client.js";

const BILDOF: Profile = {
  name: "bildof", broker: "snaptrade",
  account_id: "11111111-1111-1111-1111-111111111111",
  tax_entity: "llc-bildof",
  caps: { max_order_notional: 5000, max_single_name_pct: 10, forbidden_tools: [], forbidden_leg_shapes: [] },
};
const PERSONAL: Profile = {
  ...BILDOF, name: "personal", tax_entity: "personal",
  account_id: "22222222-2222-2222-2222-222222222222",
};
const PERSONAL2: Profile = {
  ...BILDOF, name: "personal-ira", tax_entity: "personal",
  account_id: "33333333-3333-3333-3333-333333333333",
};

const NOW = new Date("2026-04-14T12:00:00Z");

const LOSS_SELL_AAPL_IN_PERSONAL: Activity = {
  symbol: "AAPL", action: "SELL", quantity: 10, price: 150, realized_pnl: -500,
  trade_date: "2026-04-01", account_id: PERSONAL.account_id,
};
const GAIN_SELL_AAPL_IN_PERSONAL: Activity = {
  ...LOSS_SELL_AAPL_IN_PERSONAL, realized_pnl: 100, trade_date: "2026-04-05",
};
const LOSS_SELL_AAPL_IN_BILDOF: Activity = {
  ...LOSS_SELL_AAPL_IN_PERSONAL, account_id: BILDOF.account_id,
};
const LOSS_SELL_AAPL_35D_AGO: Activity = {
  ...LOSS_SELL_AAPL_IN_PERSONAL, trade_date: "2026-03-10",
};

describe("checkWashSale", () => {
  const ctxBuy = (activities: Activity[], profile: Profile = PERSONAL): WashSaleContext => ({
    action: "BUY",
    ticker: "AAPL",
    tradeDate: NOW,
    activeProfile: profile,
    allProfiles: [PERSONAL, PERSONAL2, BILDOF],
    activities,
  });

  it("flags BUY when same-entity loss sell within ±30d", () => {
    const r = checkWashSale(ctxBuy([LOSS_SELL_AAPL_IN_PERSONAL]));
    expect(r.flagged).toBe(true);
    expect(r.detail).toMatch(/AAPL/);
  });

  it("does NOT flag BUY when loss sell is in different tax entity", () => {
    const r = checkWashSale(ctxBuy([LOSS_SELL_AAPL_IN_BILDOF]));
    expect(r.flagged).toBe(false);
  });

  it("does NOT flag BUY when prior sell was a gain", () => {
    const r = checkWashSale(ctxBuy([GAIN_SELL_AAPL_IN_PERSONAL]));
    expect(r.flagged).toBe(false);
  });

  it("does NOT flag BUY when loss sell > 30 days ago", () => {
    const r = checkWashSale(ctxBuy([LOSS_SELL_AAPL_35D_AGO]));
    expect(r.flagged).toBe(false);
  });

  it("pools same-tax-entity accounts for BUY check", () => {
    const other: Activity = { ...LOSS_SELL_AAPL_IN_PERSONAL, account_id: PERSONAL2.account_id };
    const r = checkWashSale(ctxBuy([other]));
    expect(r.flagged).toBe(true);
    expect(r.detail).toMatch(/personal-ira|personal/);
  });

  it("flags SELL at loss when recent BUY within ±30d same entity", () => {
    const buy: Activity = {
      symbol: "AAPL", action: "BUY", quantity: 10, price: 200,
      trade_date: "2026-04-10", account_id: PERSONAL.account_id,
    };
    const r = checkWashSale({
      action: "SELL", ticker: "AAPL", tradeDate: NOW,
      activeProfile: PERSONAL, allProfiles: [PERSONAL, PERSONAL2, BILDOF],
      activities: [buy], sellAtLoss: true,
    });
    expect(r.flagged).toBe(true);
  });

  it("does NOT flag SELL at gain regardless of prior activity", () => {
    const buy: Activity = {
      symbol: "AAPL", action: "BUY", quantity: 10, price: 200,
      trade_date: "2026-04-10", account_id: PERSONAL.account_id,
    };
    const r = checkWashSale({
      action: "SELL", ticker: "AAPL", tradeDate: NOW,
      activeProfile: PERSONAL, allProfiles: [PERSONAL, PERSONAL2, BILDOF],
      activities: [buy], sellAtLoss: false,
    });
    expect(r.flagged).toBe(false);
  });

  it("matches options on same underlying as substantially identical", () => {
    const optLoss: Activity = {
      symbol: "AAPL 2026-06-19 150 C", underlying_symbol: "AAPL",
      action: "SELL", quantity: 1, price: 2.5, realized_pnl: -200,
      trade_date: "2026-04-01", account_id: PERSONAL.account_id,
    };
    const r = checkWashSale(ctxBuy([optLoss]));
    expect(r.flagged).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npm run -w trade-guard-mcp test -- gates/wash-sale`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/gates/wash-sale.ts
import type { Profile } from "../profiles/schema.js";
import type { Activity } from "../mcp/snaptrade-read-client.js";

const WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export interface WashSaleContext {
  action: "BUY" | "SELL";
  ticker: string;
  tradeDate: Date;
  activeProfile: Profile;
  allProfiles: Profile[];
  activities: Activity[];
  sellAtLoss?: boolean;
}

export interface WashSaleResult {
  flagged: boolean;
  detail: string;
  windowStart: string;
  windowEnd: string;
}

function entityAccounts(profile: Profile, all: Profile[]): Set<string> {
  return new Set(all.filter((p) => p.tax_entity === profile.tax_entity).map((p) => p.account_id));
}

function profileByAccount(accountId: string, all: Profile[]): Profile | undefined {
  return all.find((p) => p.account_id === accountId);
}

function matchesTicker(act: Activity, ticker: string): boolean {
  if (act.symbol === ticker) return true;
  if (act.underlying_symbol === ticker) return true;
  return false;
}

export function checkWashSale(ctx: WashSaleContext): WashSaleResult {
  const accounts = entityAccounts(ctx.activeProfile, ctx.allProfiles);
  const windowStartMs = ctx.tradeDate.getTime() - WINDOW_MS;
  const windowEndMs = ctx.tradeDate.getTime() + WINDOW_MS;

  const inPool = ctx.activities.filter(
    (a) => accounts.has(a.account_id) && matchesTicker(a, ctx.ticker)
  );
  const inWindow = inPool.filter((a) => {
    const t = new Date(a.trade_date + "T00:00:00Z").getTime();
    return t >= windowStartMs && t <= windowEndMs;
  });

  if (ctx.action === "BUY") {
    const priorLoss = inWindow.find((a) => a.action === "SELL" && (a.realized_pnl ?? 0) < 0);
    if (priorLoss) {
      const p = profileByAccount(priorLoss.account_id, ctx.allProfiles);
      return {
        flagged: true,
        detail: `BUY ${ctx.ticker} would disallow $${Math.abs(priorLoss.realized_pnl ?? 0)} loss from SELL on ${priorLoss.trade_date} in ${p?.name ?? priorLoss.account_id}`,
        windowStart: new Date(windowStartMs).toISOString().slice(0, 10),
        windowEnd: new Date(windowEndMs).toISOString().slice(0, 10),
      };
    }
  } else if (ctx.action === "SELL" && ctx.sellAtLoss) {
    const recentBuy = inWindow.find((a) => a.action === "BUY");
    if (recentBuy) {
      const p = profileByAccount(recentBuy.account_id, ctx.allProfiles);
      return {
        flagged: true,
        detail: `SELL at loss of ${ctx.ticker} would be wash by BUY on ${recentBuy.trade_date} in ${p?.name ?? recentBuy.account_id}`,
        windowStart: new Date(windowStartMs).toISOString().slice(0, 10),
        windowEnd: new Date(windowEndMs).toISOString().slice(0, 10),
      };
    }
  }

  return {
    flagged: false,
    detail: "clean",
    windowStart: new Date(windowStartMs).toISOString().slice(0, 10),
    windowEnd: new Date(windowEndMs).toISOString().slice(0, 10),
  };
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npm run -w trade-guard-mcp test -- gates/wash-sale`
Expected: 8 PASS.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat(trade-guard): wash-sale gate (±30d, tax_entity pool, options-on-underlying)"
```

---

## Task 8: check_trade compose + tool (TDD)

**Files:**
- Create: `mcp-servers/trade-guard/src/gates/compose.ts`
- Create: `mcp-servers/trade-guard/src/tools/check-trade.ts`
- Create: `mcp-servers/trade-guard/test/gates/compose.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/gates/compose.test.ts
import { describe, expect, it } from "vitest";
import { composeCheckTrade } from "../../src/gates/compose.js";
import type { Profile } from "../../src/profiles/schema.js";

const BILDOF: Profile = {
  name: "bildof", broker: "snaptrade",
  account_id: "11111111-1111-1111-1111-111111111111",
  tax_entity: "llc-bildof",
  caps: { max_order_notional: 5000, max_single_name_pct: 10, forbidden_tools: [], forbidden_leg_shapes: [] },
};

describe("composeCheckTrade", () => {
  it("passes clean trade", async () => {
    const r = await composeCheckTrade({
      profile: BILDOF,
      allProfiles: [BILDOF],
      trade: {
        tool: "mleg_place", ticker: "AAPL",
        direction: "SELL_TO_OPEN", qty: 1, notional_usd: 3000,
        portfolio_total_usd: 100000, existing_ticker_exposure_usd: 0,
      },
      fetchActivities: async () => [],
    });
    expect(r.pass).toBe(true);
  });

  it("composes caps + wash-sale reasons", async () => {
    const r = await composeCheckTrade({
      profile: BILDOF,
      allProfiles: [BILDOF],
      trade: {
        tool: "equity_force_place", ticker: "AAPL",
        direction: "BUY", qty: 10, notional_usd: 20000,
        portfolio_total_usd: 100000, existing_ticker_exposure_usd: 0,
      },
      fetchActivities: async () => [
        { symbol: "AAPL", action: "SELL", quantity: 10, price: 150, realized_pnl: -500,
          trade_date: new Date().toISOString().slice(0, 10), account_id: BILDOF.account_id },
      ],
    });
    expect(r.pass).toBe(false);
    expect(r.reasons.some((x) => /notional/.test(x))).toBe(true);
    expect(r.reasons.some((x) => /wash/i.test(x))).toBe(true);
  });

  it("warns but passes when activities fetch fails and require=false", async () => {
    const r = await composeCheckTrade({
      profile: BILDOF,
      allProfiles: [BILDOF],
      trade: {
        tool: "equity_force_place", ticker: "AAPL", direction: "BUY",
        qty: 1, notional_usd: 100, portfolio_total_usd: 100000, existing_ticker_exposure_usd: 0,
      },
      fetchActivities: async () => { throw new Error("snaptrade-read down"); },
      requireWashSaleCheck: false,
    });
    expect(r.pass).toBe(true);
    expect(r.warnings.some((x) => /wash-sale check unavailable/.test(x))).toBe(true);
  });

  it("rejects when activities fetch fails and require=true", async () => {
    const r = await composeCheckTrade({
      profile: BILDOF,
      allProfiles: [BILDOF],
      trade: {
        tool: "equity_force_place", ticker: "AAPL", direction: "BUY",
        qty: 1, notional_usd: 100, portfolio_total_usd: 100000, existing_ticker_exposure_usd: 0,
      },
      fetchActivities: async () => { throw new Error("snaptrade-read down"); },
      requireWashSaleCheck: true,
    });
    expect(r.pass).toBe(false);
    expect(r.reasons[0]).toMatch(/wash-sale check required/);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npm run -w trade-guard-mcp test -- gates/compose`
Expected: FAIL.

- [ ] **Step 3: Implement compose**

```ts
// src/gates/compose.ts
import type { Profile } from "../profiles/schema.js";
import type { Activity } from "../mcp/snaptrade-read-client.js";
import { checkCaps, type TradeProposal, type GateResult } from "./caps.js";
import { checkWashSale } from "./wash-sale.js";

export interface ComposeInput {
  profile: Profile;
  allProfiles: Profile[];
  trade: TradeProposal;
  fetchActivities: (accountIds: string[], since: Date) => Promise<Activity[]>;
  requireWashSaleCheck?: boolean;
  now?: Date;
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function composeCheckTrade(input: ComposeInput): Promise<GateResult> {
  const caps = checkCaps(input.profile, input.trade);
  const reasons = [...caps.reasons];
  const warnings = [...caps.warnings];

  const now = input.now ?? new Date();
  const since = new Date(now.getTime() - THIRTY_DAYS_MS);
  const poolAccounts = input.allProfiles
    .filter((p) => p.tax_entity === input.profile.tax_entity)
    .map((p) => p.account_id);

  let activities: Activity[] = [];
  try {
    activities = await input.fetchActivities(poolAccounts, since);
  } catch (e) {
    const msg = `wash-sale check unavailable: ${(e as Error).message}`;
    if (input.requireWashSaleCheck) reasons.push(`wash-sale check required but ${msg}`);
    else warnings.push(msg);
    return { pass: reasons.length === 0, reasons, warnings };
  }

  const sellAtLoss = input.trade.direction.startsWith("SELL") &&
    input.trade.notional_usd < input.trade.existing_ticker_exposure_usd;

  const ws = checkWashSale({
    action: input.trade.direction.startsWith("BUY") ? "BUY" : "SELL",
    ticker: input.trade.ticker,
    tradeDate: now,
    activeProfile: input.profile,
    allProfiles: input.allProfiles,
    activities,
    sellAtLoss,
  });
  if (ws.flagged) reasons.push(`wash-sale: ${ws.detail}`);

  return { pass: reasons.length === 0, reasons, warnings };
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npm run -w trade-guard-mcp test -- gates/compose`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat(trade-guard): compose caps + wash-sale into check_trade result"
```

---

## Task 9: TLH scanner (TDD)

**Files:**
- Create: `mcp-servers/trade-guard/src/tools/scan-tlh.ts`
- Create: `mcp-servers/trade-guard/test/tools/scan-tlh.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/tools/scan-tlh.test.ts
import { describe, expect, it } from "vitest";
import { scanTlh, type Position } from "../../src/tools/scan-tlh.js";
import type { Profile } from "../../src/profiles/schema.js";
import type { Activity } from "../../src/mcp/snaptrade-read-client.js";

const PERSONAL: Profile = {
  name: "personal", broker: "snaptrade",
  account_id: "22222222-2222-2222-2222-222222222222",
  tax_entity: "personal",
  caps: { max_order_notional: 50000, max_single_name_pct: 50, forbidden_tools: [], forbidden_leg_shapes: [] },
};

const positions: Position[] = [
  { ticker: "AAPL", qty: 100, cost_basis_per_unit: 200, current_price: 180, account_id: PERSONAL.account_id },
  { ticker: "NVDA", qty: 50,  cost_basis_per_unit: 100, current_price: 120, account_id: PERSONAL.account_id },
  { ticker: "MSFT", qty: 20,  cost_basis_per_unit: 400, current_price: 395, account_id: PERSONAL.account_id },
];

describe("scanTlh", () => {
  it("returns only positions with unrealized loss > threshold, wash-sale-clean", async () => {
    const r = await scanTlh({
      taxEntity: "personal",
      thresholdUsd: 500,
      profiles: [PERSONAL],
      positions,
      activities: [],
      now: new Date("2026-04-14T12:00:00Z"),
    });
    expect(r.map((c) => c.ticker)).toEqual(["AAPL"]);
    expect(r[0]!.unrealized_loss_usd).toBe(2000);
  });

  it("excludes candidates with recent buy (wash-sale window)", async () => {
    const buy: Activity = {
      symbol: "AAPL", action: "BUY", quantity: 10, price: 180,
      trade_date: "2026-04-10", account_id: PERSONAL.account_id,
    };
    const r = await scanTlh({
      taxEntity: "personal", thresholdUsd: 500,
      profiles: [PERSONAL], positions, activities: [buy],
      now: new Date("2026-04-14T12:00:00Z"),
    });
    expect(r.map((c) => c.ticker)).toEqual([]);
  });

  it("scopes to tax_entity", async () => {
    const bildof: Profile = { ...PERSONAL, name: "bildof", tax_entity: "llc-bildof",
      account_id: "11111111-1111-1111-1111-111111111111" };
    const r = await scanTlh({
      taxEntity: "llc-bildof", thresholdUsd: 500,
      profiles: [PERSONAL, bildof], positions, activities: [],
      now: new Date("2026-04-14T12:00:00Z"),
    });
    expect(r).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `npm run -w trade-guard-mcp test -- tools/scan-tlh`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/tools/scan-tlh.ts
import type { Profile } from "../profiles/schema.js";
import type { Activity } from "../mcp/snaptrade-read-client.js";
import { checkWashSale } from "../gates/wash-sale.js";

export interface Position {
  ticker: string;
  qty: number;
  cost_basis_per_unit: number;
  current_price: number;
  account_id: string;
}

export interface TlhCandidate {
  ticker: string;
  unrealized_loss_usd: number;
  qty: number;
  account: string;
  wash_sale_clean: boolean;
}

export interface ScanInput {
  taxEntity: string;
  thresholdUsd: number;
  profiles: Profile[];
  positions: Position[];
  activities: Activity[];
  now: Date;
}

export async function scanTlh(input: ScanInput): Promise<TlhCandidate[]> {
  const inPool = input.profiles.filter((p) => p.tax_entity === input.taxEntity);
  if (inPool.length === 0) return [];
  const accountSet = new Set(inPool.map((p) => p.account_id));

  const candidates: TlhCandidate[] = [];
  for (const pos of input.positions) {
    if (!accountSet.has(pos.account_id)) continue;
    const unrealized = (pos.cost_basis_per_unit - pos.current_price) * pos.qty;
    if (unrealized < input.thresholdUsd) continue;

    const activeProfile = inPool.find((p) => p.account_id === pos.account_id)!;
    const ws = checkWashSale({
      action: "SELL", ticker: pos.ticker, tradeDate: input.now,
      activeProfile, allProfiles: input.profiles, activities: input.activities, sellAtLoss: true,
    });
    if (ws.flagged) continue;

    candidates.push({
      ticker: pos.ticker,
      unrealized_loss_usd: unrealized,
      qty: pos.qty,
      account: activeProfile.name,
      wash_sale_clean: true,
    });
  }
  candidates.sort((a, b) => b.unrealized_loss_usd - a.unrealized_loss_usd);
  return candidates;
}
```

- [ ] **Step 4: Run — expect pass**

Run: `npm run -w trade-guard-mcp test -- tools/scan-tlh`
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat(trade-guard): TLH scanner with wash-sale exclusion"
```

---

## Task 10: Credential redaction (TDD)

**Files:**
- Create: `mcp-servers/trade-guard/src/redact.ts`
- Create: `mcp-servers/trade-guard/test/redact.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/redact.test.ts
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
```

- [ ] **Step 2: Run — expect fail**

Run: `npm run -w trade-guard-mcp test -- redact`
Expected: FAIL.

- [ ] **Step 3: Implement**

```ts
// src/redact.ts
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
```

- [ ] **Step 4: Run — expect pass**

Run: `npm run -w trade-guard-mcp test -- redact`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add .
git commit -m "feat(trade-guard): credential redaction helper"
```

---

## Task 11: MCP tool wiring + server entrypoint

**Files:**
- Create: `mcp-servers/trade-guard/src/tools/check-trade.ts`
- Create: `mcp-servers/trade-guard/src/tools/check-wash-sale.ts`
- Create: `mcp-servers/trade-guard/src/tools/list-profiles.ts`
- Create: `mcp-servers/trade-guard/src/tools/set-profile.ts`
- Replace: `mcp-servers/trade-guard/src/index.ts`

> Integration test for this is Task 12. This task wires the tools; the test verifies stdio behavior end to end.

- [ ] **Step 1: Implement `check-trade.ts`**

```ts
// src/tools/check-trade.ts
import { z } from "zod";
import { composeCheckTrade } from "../gates/compose.js";
import type { Profile } from "../profiles/schema.js";
import type { SnaptradeReadClient } from "../mcp/snaptrade-read-client.js";

export const CheckTradeArgs = z.object({
  profile: z.string().min(1),
  tool: z.string().min(1),
  ticker: z.string().min(1).max(20),
  direction: z.enum(["BUY", "SELL", "BUY_TO_OPEN", "BUY_TO_CLOSE", "SELL_TO_OPEN", "SELL_TO_CLOSE"]),
  qty: z.number().positive(),
  notional_usd: z.number().nonnegative(),
  leg_shape: z.string().optional(),
  portfolio_total_usd: z.number().nonnegative().default(0),
  existing_ticker_exposure_usd: z.number().nonnegative().default(0),
  require_wash_sale_check: z.boolean().default(false),
});

export interface CheckTradeDeps {
  allProfiles: Profile[];
  snaptradeRead: SnaptradeReadClient | null;
}

export async function checkTradeHandler(
  raw: unknown,
  deps: CheckTradeDeps
): Promise<{ pass: boolean; reasons: string[]; warnings: string[] }> {
  const args = CheckTradeArgs.parse(raw);
  const profile = deps.allProfiles.find((p) => p.name === args.profile);
  if (!profile) {
    return { pass: false, reasons: [`unknown profile: ${args.profile}`], warnings: [] };
  }
  return composeCheckTrade({
    profile,
    allProfiles: deps.allProfiles,
    trade: {
      tool: args.tool, ticker: args.ticker, direction: args.direction,
      qty: args.qty, notional_usd: args.notional_usd,
      leg_shape: args.leg_shape,
      portfolio_total_usd: args.portfolio_total_usd,
      existing_ticker_exposure_usd: args.existing_ticker_exposure_usd,
    },
    fetchActivities: async (accounts, since) => {
      if (!deps.snaptradeRead) throw new Error("snaptrade-read not configured");
      return deps.snaptradeRead.getActivities(accounts, since);
    },
    requireWashSaleCheck: args.require_wash_sale_check,
  });
}
```

- [ ] **Step 2: Implement `check-wash-sale.ts`**

```ts
// src/tools/check-wash-sale.ts
import { z } from "zod";
import { checkWashSale } from "../gates/wash-sale.js";
import type { Profile } from "../profiles/schema.js";
import type { SnaptradeReadClient } from "../mcp/snaptrade-read-client.js";

export const CheckWashSaleArgs = z.object({
  ticker: z.string().min(1),
  action: z.enum(["BUY", "SELL"]),
  tax_entity: z.enum(["personal", "llc-bildof", "llc-innocore"]),
  sell_at_loss: z.boolean().default(false),
});

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export async function checkWashSaleHandler(
  raw: unknown,
  deps: { allProfiles: Profile[]; snaptradeRead: SnaptradeReadClient | null }
) {
  const args = CheckWashSaleArgs.parse(raw);
  const pool = deps.allProfiles.filter((p) => p.tax_entity === args.tax_entity);
  if (pool.length === 0) return { flagged: false, detail: `no profiles in ${args.tax_entity}`, windowStart: "", windowEnd: "" };

  const now = new Date();
  const since = new Date(now.getTime() - THIRTY_DAYS_MS);
  if (!deps.snaptradeRead) return { flagged: false, detail: "snaptrade-read unavailable — check skipped", windowStart: "", windowEnd: "" };
  const activities = await deps.snaptradeRead.getActivities(pool.map((p) => p.account_id), since);
  return checkWashSale({
    action: args.action, ticker: args.ticker, tradeDate: now,
    activeProfile: pool[0]!, allProfiles: deps.allProfiles, activities,
    sellAtLoss: args.sell_at_loss,
  });
}
```

- [ ] **Step 3: Implement `list-profiles.ts` + `set-profile.ts`**

```ts
// src/tools/list-profiles.ts
import type { Profile } from "../profiles/schema.js";
export async function listProfilesHandler(
  _raw: unknown,
  deps: { allProfiles: Profile[] }
) {
  return deps.allProfiles.map((p) => ({
    name: p.name, broker: p.broker, tax_entity: p.tax_entity,
    caps_summary: `notional ≤ $${p.caps.max_order_notional}, single-name ≤ ${p.caps.max_single_name_pct}%`,
  }));
}
```

```ts
// src/tools/set-profile.ts
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
```

- [ ] **Step 4: Replace `src/index.ts` with MCP server wiring**

```ts
// src/index.ts
#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { loadAllProfiles } from "./profiles/loader.js";
import { KIT_ROOT, PROFILES_DIR } from "./config.js";
import { connectSnaptradeRead, type SnaptradeReadClient } from "./mcp/snaptrade-read-client.js";
import { CheckTradeArgs, checkTradeHandler } from "./tools/check-trade.js";
import { CheckWashSaleArgs, checkWashSaleHandler } from "./tools/check-wash-sale.js";
import { listProfilesHandler } from "./tools/list-profiles.js";
import { SetProfileArgs, setProfileHandler } from "./tools/set-profile.js";
import { redact } from "./redact.js";

const TOOLS = [
  { name: "check_trade", description: "Gate a proposed trade (caps + wash-sale).",
    inputSchema: { type: "object", additionalProperties: false,
      properties: CheckTradeArgs.shape as any, required: ["profile", "tool", "ticker", "direction", "qty", "notional_usd"] } },
  { name: "check_wash_sale", description: "Check wash-sale status for a ticker + action.",
    inputSchema: { type: "object", additionalProperties: false,
      properties: CheckWashSaleArgs.shape as any, required: ["ticker", "action", "tax_entity"] } },
  { name: "list_profiles", description: "List available trading profiles.",
    inputSchema: { type: "object", additionalProperties: false, properties: {} } },
  { name: "set_profile", description: "Set the active profile in session state.",
    inputSchema: { type: "object", additionalProperties: false,
      properties: SetProfileArgs.shape as any, required: ["name"] } },
];

const SECRETS = [
  process.env.SNAPTRADE_CONSUMER_KEY, process.env.SNAPTRADE_USER_SECRET,
  process.env.SNAPTRADE_USER_ID, process.env.SNAPTRADE_CLIENT_ID,
].filter((x): x is string => !!x);

async function main() {
  const allProfiles = await loadAllProfiles(PROFILES_DIR).catch(() => []);
  let snaptradeRead: SnaptradeReadClient | null = null;
  if (process.env.SNAPTRADE_READ_COMMAND) {
    try {
      snaptradeRead = await connectSnaptradeRead({
        command: process.env.SNAPTRADE_READ_COMMAND,
        args: (process.env.SNAPTRADE_READ_ARGS ?? "").split(" ").filter(Boolean),
        env: process.env as Record<string, string>,
      });
    } catch (e) {
      process.stderr.write(`trade-guard: could not start snaptrade-read: ${(e as Error).message}\n`);
    }
  }

  const server = new Server({ name: "trade-guard", version: "0.1.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const deps = { allProfiles, snaptradeRead };
    try {
      let result: unknown;
      switch (req.params.name) {
        case "check_trade":     result = await checkTradeHandler(req.params.arguments, deps); break;
        case "check_wash_sale": result = await checkWashSaleHandler(req.params.arguments, deps); break;
        case "list_profiles":   result = await listProfilesHandler(req.params.arguments, deps); break;
        case "set_profile":     result = await setProfileHandler(req.params.arguments, deps); break;
        default: throw new Error(`unknown tool: ${req.params.name}`);
      }
      const safe = redact(result, SECRETS);
      return { content: [{ type: "text", text: JSON.stringify(safe, null, 2) }] };
    } catch (e) {
      const msg = (e as Error).message;
      const safeMsg = String(redact(msg, SECRETS));
      return { content: [{ type: "text", text: `error: ${safeMsg}` }], isError: true };
    }
  });
  await server.connect(new StdioServerTransport());
  process.stderr.write(`trade-guard: ready (profiles=${allProfiles.length}, kit_root=${KIT_ROOT})\n`);
}

main().catch((e) => { process.stderr.write(`trade-guard fatal: ${e?.message}\n`); process.exit(1); });
```

- [ ] **Step 5: Build + typecheck**

Run: `npm run -w trade-guard-mcp build && npm run -w trade-guard-mcp typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat(trade-guard): MCP server entrypoint wiring 4 tools"
```

---

## Task 12: MCP integration test (stdio)

**Files:**
- Create: `mcp-servers/trade-guard/test/integration/mcp.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// test/integration/mcp.test.ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { writeFile, mkdir, mkdtemp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

describe("trade-guard-mcp stdio integration", () => {
  let kitRoot: string;
  let proc: ChildProcess | undefined;
  let client: Client | undefined;

  beforeEach(async () => {
    kitRoot = await mkdtemp(join(tmpdir(), "tg-mcp-"));
    const profilesDir = join(kitRoot, "profiles");
    await mkdir(profilesDir, { recursive: true });
    await writeFile(
      join(profilesDir, "bildof.md"),
      `---\nname: bildof\nbroker: snaptrade\naccount_id: 11111111-1111-1111-1111-111111111111\ntax_entity: llc-bildof\ncaps:\n  max_order_notional: 5000\n  max_single_name_pct: 10\n---\nbody`
    );
    const transport = new StdioClientTransport({
      command: "node",
      args: [join(process.cwd(), "dist/index.js")],
      env: { ...process.env, MCP_TRADER_KIT_ROOT: kitRoot },
    });
    client = new Client({ name: "test", version: "0.0.0" }, { capabilities: {} });
    await client.connect(transport);
  });

  afterEach(async () => {
    if (client) await client.close();
    if (proc) proc.kill();
  });

  it("lists 4 tools", async () => {
    const r = await client!.listTools();
    const names = r.tools.map((t) => t.name).sort();
    expect(names).toEqual(["check_trade", "check_wash_sale", "list_profiles", "set_profile"]);
  });

  it("list_profiles returns the seeded profile", async () => {
    const r = await client!.callTool({ name: "list_profiles", arguments: {} });
    const text = (r.content as any[])[0].text;
    expect(text).toMatch(/bildof/);
  });

  it("check_trade rejects over-cap notional", async () => {
    const r = await client!.callTool({
      name: "check_trade",
      arguments: {
        profile: "bildof", tool: "equity_force_place", ticker: "AAPL",
        direction: "BUY", qty: 100, notional_usd: 20000,
        portfolio_total_usd: 100000, existing_ticker_exposure_usd: 0,
        require_wash_sale_check: false,
      },
    });
    const text = (r.content as any[])[0].text;
    expect(text).toMatch(/notional/);
    expect(JSON.parse(text).pass).toBe(false);
  });
});
```

- [ ] **Step 2: Ensure dist is built**

Run: `npm run -w trade-guard-mcp build`

- [ ] **Step 3: Run — expect pass**

Run: `npm run -w trade-guard-mcp test -- integration`
Expected: 3 PASS.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "test(trade-guard): stdio integration test for 4 tools"
```

---

## Task 13: PreToolUse hook script

**Files:**
- Create: `scripts/pre-tool-use.js`

> The hook script is node, not TS, so it can be invoked directly via shebang without a build step. It is self-contained — zero deps.

- [ ] **Step 1: Create hook script**

```js
#!/usr/bin/env node
// scripts/pre-tool-use.js
// Reads Claude Code PreToolUse payload on stdin; calls trade-guard check_trade;
// exits 0 to allow, 2 to block. See docs/risk-gates.md.

import { spawn } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const KIT_ROOT = process.env.MCP_TRADER_KIT_ROOT || join(homedir(), ".mcp-trader-kit");
const SESSION_FILE = join(KIT_ROOT, ".session.json");
const FAIL_CLOSED = process.env.MCP_TRADER_KIT_FAIL_OPEN !== "true";

async function readStdin() {
  let data = "";
  for await (const chunk of process.stdin) data += chunk;
  return data;
}

function loadActiveProfile() {
  if (!existsSync(SESSION_FILE)) return null;
  try { return JSON.parse(readFileSync(SESSION_FILE, "utf8")).active_profile ?? null; }
  catch { return null; }
}

function blocked(reason) {
  process.stderr.write(`[trade-guard] BLOCKED: ${reason}\n`);
  process.exit(2);
}

async function callCheckTrade(payload) {
  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["-y", "trade-guard-mcp"], { stdio: ["pipe", "pipe", "inherit"] });
    let out = "";
    child.stdout.on("data", (c) => { out += c; });
    child.on("close", () => {
      try { resolve(JSON.parse(out.split("\n").find((l) => l.includes("\"result\"")) || "{}")); }
      catch (e) { reject(e); }
    });
    child.on("error", reject);
    const req = {
      jsonrpc: "2.0", id: 1, method: "tools/call",
      params: { name: "check_trade", arguments: payload },
    };
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: 0, method: "initialize",
      params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "hook", version: "0" } } }) + "\n");
    child.stdin.write(JSON.stringify(req) + "\n");
    child.stdin.end();
  });
}

function extractTradeArgs(toolName, toolInput, profile) {
  const baseProfile = profile || "default";
  const leg = toolInput.legs?.[0];
  return {
    profile: baseProfile,
    tool: toolName.replace(/^mcp__[^_]+__/, ""),
    ticker: toolInput.ticker || toolInput.symbol || leg?.symbol || "UNKNOWN",
    direction: toolInput.action || leg?.action || "BUY",
    qty: Number(toolInput.units || toolInput.quantity || leg?.quantity || 1),
    notional_usd: Number(toolInput.price || 0) * Number(toolInput.units || toolInput.quantity || 0),
    portfolio_total_usd: 0,
    existing_ticker_exposure_usd: 0,
    require_wash_sale_check: false,
  };
}

(async () => {
  let input;
  try { input = JSON.parse(await readStdin()); }
  catch { if (FAIL_CLOSED) blocked("invalid hook payload"); else process.exit(0); }

  const active = loadActiveProfile();
  if (!active) {
    if (FAIL_CLOSED) blocked("no active profile — run set_profile first");
    else process.exit(0);
  }

  const args = extractTradeArgs(input.tool_name, input.tool_input || {}, active);
  let result;
  try { result = await callCheckTrade(args); }
  catch (e) {
    if (FAIL_CLOSED) blocked(`gate unavailable: ${e.message}`);
    else process.exit(0);
  }

  const payload = JSON.parse((result?.result?.content ?? [])[0]?.text ?? "{}");
  if (payload.pass === false) blocked((payload.reasons || []).join("; "));
  if (payload.warnings?.length) process.stderr.write(`[trade-guard] warnings: ${payload.warnings.join("; ")}\n`);
  process.exit(0);
})().catch((e) => { if (FAIL_CLOSED) blocked(e.message); else process.exit(0); });
```

- [ ] **Step 2: Make executable**

Run: `chmod +x /Users/Vivek/Development/mcp-trader-kit/scripts/pre-tool-use.js`

- [ ] **Step 3: Smoke test (hook rejects bad payload fail-closed)**

Run: `echo '{}' | node /Users/Vivek/Development/mcp-trader-kit/scripts/pre-tool-use.js; echo "exit=$?"`
Expected: `exit=2` with `[trade-guard] BLOCKED: no active profile — run set_profile first` on stderr (profile dir empty).

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat(hook): PreToolUse gate script invokes trade-guard-mcp via stdio"
```

---

## Task 14: CLAUDE.md template

**Files:**
- Create: `templates/CLAUDE.md`

- [ ] **Step 1: Write CLAUDE.md template**

```md
# mcp-trader-kit — session rules

Auto-loads at every Claude Code session start inside this vault.

## 1. Always-load docs (read FIRST, every session)
1. `wiki/trading/dashboard.md` — top-of-mind summary.
2. `wiki/trading/regime.md` — market regime + mode.
3. `wiki/trading/risk-signals.md` — CRI + VCG readings.
4. `wiki/trading/portfolio-master.md` — cross-broker aggregate.
5. `wiki/trading/theses/index.md` — active theses.
6. `wiki/trading/open-questions.md` — top 3 items surfaced as prompts.

## 2. Staged-proposal convention (MANDATORY before destructive tools)
Before calling any destructive MCP tool (SnapTrade `equity_force_place`, `equity_confirm`, `mleg_place`, `cancel_order`; TradeStation `place_order`/`cancel_order`), render a numbered proposal block:

```
PROPOSAL — <PROFILE_NAME>
1. <action summary>
   Notional: $<x> | Max loss: $<y> | Wash-sale: <status>
   Caps: <pass|violation-detail>
2. <alternative>
...
```

Wait for natural-language approval ("do #1", "skip", "change qty", "what's max loss on #2"). Only emit the destructive tool call after the user has approved a specific numbered option.

The PreToolUse hook enforces hard rules regardless — proposals are for visibility.

## 3. Active profile
The active profile lives in `~/.mcp-trader-kit/.session.json`. To switch mid-session, call `trade-guard.set_profile(name)`. Every destructive call re-reads the active profile — no caching.

On session start, ask "which profile?" if none is set. Never emit a destructive tool without an active profile.

## 4. Auto-persist rule
Persist durable state to the vault without asking:
- New trade decisions → `wiki/trading/trades/YYYY-MM-DD.md` (append-only).
- Thesis updates → `wiki/trading/theses/<slug>.md` (respects `agent_writeable` flag).
- Regime shifts → `wiki/trading/regime.md`.
- Session summary at turn-end → `wiki/trading/sessions/<id>.md`.

Do not ask "want me to persist this?" — just do it.

## 5. Data freshness
If any dashboard figure is >4h stale OR user asks for "refresh":
```
snaptrade_check_status
snaptrade_list_accounts
snaptrade_portfolio_summary
```
Then update `portfolio-master.md` + `dashboard.md`.

## 6. Rules
- All portfolio figures MUST trace to a source via wikilink.
- Dates ISO `YYYY-MM-DD`. Currency `$1,234.56`.
- Append-only: trade logs, open-questions resolutions, thesis revisions.
- Never disable the PreToolUse hook.
- Before any destructive tool: (a) confirm profile (b) render proposal (c) wait for explicit approval.
```

- [ ] **Step 2: Commit**

```bash
git add .
git commit -m "feat(templates): CLAUDE.md with proposal convention + auto-persist + rules"
```

---

## Task 15: Profile + vault templates

**Files:**
- Create: `templates/profiles/example-personal.md`
- Create: `templates/profiles/example-llc.md`
- Create: `templates/vault/wiki/trading/dashboard.md`
- Create: `templates/vault/wiki/trading/regime.md`
- Create: `templates/vault/wiki/trading/risk-signals.md`
- Create: `templates/vault/wiki/trading/portfolio-master.md`
- Create: `templates/vault/wiki/trading/open-questions.md`
- Create: `templates/vault/wiki/trading/theses/index.md`
- Create: `templates/vault/wiki/trading/trades/.gitkeep`
- Create: `templates/vault/wiki/trading/sessions/.gitkeep`
- Create: `templates/vault/wiki/trading/scanner-signals.md`
- Create: `templates/claude-settings.json`

- [ ] **Step 1: Create `templates/profiles/example-personal.md`**

```md
---
name: example-personal
broker: snaptrade
account_id: 00000000-0000-0000-0000-000000000000
tax_entity: personal
caps:
  max_order_notional: 10000
  max_single_name_pct: 25
  forbidden_tools: []
  forbidden_leg_shapes: [naked_put, naked_call]
---

# example-personal profile
Individual taxable brokerage account. Replace `account_id` with the UUID from `snaptrade_list_accounts`.
```

- [ ] **Step 2: Create `templates/profiles/example-llc.md`**

```md
---
name: example-llc
broker: snaptrade
account_id: 00000000-0000-0000-0000-000000000000
tax_entity: llc-bildof
caps:
  max_order_notional: 5000
  max_single_name_pct: 10
  forbidden_tools: []
  forbidden_leg_shapes: [naked_put, naked_call, naked_straddle, naked_strangle]
vault_link: bildof/log.md
---

# example-llc profile
LLC partnership account. Income-tilted, no margin, no naked options. Replace `account_id` + `tax_entity` values.
```

- [ ] **Step 3: Create vault doc templates**

Each of the six files below uses YAML frontmatter + placeholder content. All are `agent_writeable: true` except `regime.md` and `risk-signals.md` (human-authored).

`templates/vault/wiki/trading/dashboard.md`:
```md
---
title: Trading Dashboard
type: dashboard
status: active
created: YYYY-MM-DD
updated: YYYY-MM-DD
tags: [#dashboard]
agent_writeable: true
---
# Trading Dashboard
## Totals
- (populate via refresh)
## Urgent
- (populate)
## Last refresh
- YYYY-MM-DDTHH:MM:SSZ
```

`templates/vault/wiki/trading/regime.md`:
```md
---
title: Market Regime
type: regime
status: active
created: YYYY-MM-DD
updated: YYYY-MM-DD
tags: [#regime]
agent_writeable: false
---
# Market Regime
**Mode**: cautious
**Decision**: no new aggressive longs
(edit manually to update)
```

`templates/vault/wiki/trading/risk-signals.md`:
```md
---
title: Risk Signals
type: risk
status: active
created: YYYY-MM-DD
updated: YYYY-MM-DD
tags: [#risk]
agent_writeable: false
---
# Risk Signals
- CRI: TBD
- VCG: TBD
```

`templates/vault/wiki/trading/portfolio-master.md`:
```md
---
title: Portfolio Master
type: portfolio
status: active
created: YYYY-MM-DD
updated: YYYY-MM-DD
tags: [#portfolio]
agent_writeable: true
---
# Portfolio Master
(populate via refresh)
```

`templates/vault/wiki/trading/open-questions.md`:
```md
---
title: Open Questions
type: decision-queue
status: active
created: YYYY-MM-DD
updated: YYYY-MM-DD
tags: [#decisions]
agent_writeable: true
---
# Open Questions
1. (append-only)
```

`templates/vault/wiki/trading/theses/index.md`:
```md
---
title: Theses Index
type: theses-index
status: active
created: YYYY-MM-DD
updated: YYYY-MM-DD
tags: [#theses]
agent_writeable: true
---
# Theses Index
- (link thesis docs here)
```

`templates/vault/wiki/trading/scanner-signals.md`:
```md
---
title: Scanner Signals
type: signals
status: active
created: YYYY-MM-DD
updated: YYYY-MM-DD
tags: [#signals]
agent_writeable: true
---
# Scanner Signals
(UW/scanner output — append-only, dated sections)
```

- [ ] **Step 4: Create `.gitkeep` stubs**

```bash
mkdir -p templates/vault/wiki/trading/trades templates/vault/wiki/trading/sessions
touch templates/vault/wiki/trading/trades/.gitkeep
touch templates/vault/wiki/trading/sessions/.gitkeep
```

- [ ] **Step 5: Create `templates/claude-settings.json`**

```json
{
  "mcpServers": {
    "trade-guard": { "command": "npx", "args": ["-y", "trade-guard-mcp"] },
    "snaptrade-trade": { "command": "npx", "args": ["-y", "snaptrade-trade-mcp"] },
    "snaptrade-read": { "command": "npx", "args": ["-y", "snaptrade-mcp-ts"] }
  },
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "mcp__snaptrade-trade__equity_force_place|mcp__snaptrade-trade__equity_confirm|mcp__snaptrade-trade__mleg_place|mcp__snaptrade-trade__cancel_order",
        "command": "node ${HOME}/.mcp-trader-kit/scripts/pre-tool-use.js",
        "description": "Enforce trade-guard risk gates"
      }
    ]
  }
}
```

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "feat(templates): profile + vault + claude-settings templates"
```

---

## Task 16: `setup.sh` interactive installer

**Files:**
- Create: `scripts/setup.sh`

- [ ] **Step 1: Write setup.sh**

```bash
#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
KIT_ROOT="${MCP_TRADER_KIT_ROOT:-$HOME/.mcp-trader-kit}"
VAULT_DEFAULT="$PWD/vault"

say() { printf '\n\033[1;36m› %s\033[0m\n' "$*"; }
ask() { local prompt="$1" default="${2:-}" reply; read -r -p "$prompt [${default}]: " reply; printf '%s' "${reply:-$default}"; }

say "mcp-trader-kit setup"
echo "Repo: $REPO_ROOT"
echo "Kit state dir: $KIT_ROOT"

VAULT_PATH="$(ask "Vault path" "$VAULT_DEFAULT")"

say "Creating directories"
mkdir -p "$KIT_ROOT/profiles" "$KIT_ROOT/scripts"
mkdir -p "$VAULT_PATH/.claude" "$VAULT_PATH/wiki/trading"

say "Copying templates → vault"
cp -R "$REPO_ROOT/templates/vault/." "$VAULT_PATH/"
cp "$REPO_ROOT/templates/CLAUDE.md" "$VAULT_PATH/CLAUDE.md"

say "Copying claude-settings.json → vault/.claude/settings.json"
SETTINGS="$VAULT_PATH/.claude/settings.json"
if [[ -f "$SETTINGS" ]]; then
  echo "  $SETTINGS exists — leaving alone (merge manually if needed)"
else
  sed "s|\${HOME}|$HOME|g" "$REPO_ROOT/templates/claude-settings.json" > "$SETTINGS"
fi

say "Copying hook script → $KIT_ROOT/scripts/"
cp "$REPO_ROOT/scripts/pre-tool-use.js" "$KIT_ROOT/scripts/pre-tool-use.js"
chmod +x "$KIT_ROOT/scripts/pre-tool-use.js"

say "Copying profile templates"
for tpl in example-personal example-llc; do
  if [[ ! -f "$KIT_ROOT/profiles/$tpl.md" ]]; then
    cp "$REPO_ROOT/templates/profiles/$tpl.md" "$KIT_ROOT/profiles/$tpl.md"
  fi
done

say "Writing .env template (if missing)"
if [[ ! -f "$KIT_ROOT/.env" ]]; then
  cat > "$KIT_ROOT/.env" <<'EOF'
# mcp-trader-kit secrets — edit these
ANTHROPIC_API_KEY=
SNAPTRADE_CLIENT_ID=
SNAPTRADE_CONSUMER_KEY=
SNAPTRADE_USER_ID=
SNAPTRADE_USER_SECRET=
EXA_API_KEY=
UW_TOKEN=
EOF
  chmod 600 "$KIT_ROOT/.env"
fi

say "Installing MCP packages (this may take a minute)"
npm install -g trade-guard-mcp snaptrade-trade-mcp snaptrade-mcp-ts 2>/dev/null || \
  echo "  (global install skipped — using 'npx -y' on demand is fine)"

say "Next steps"
cat <<EOF
1. Edit $KIT_ROOT/.env with your credentials.
2. Edit $KIT_ROOT/profiles/*.md — replace placeholder account_ids with UUIDs from snaptrade_list_accounts.
3. Run: bash $REPO_ROOT/scripts/doctor.sh
4. cd $VAULT_PATH && claude
EOF
```

- [ ] **Step 2: Make executable**

Run: `chmod +x /Users/Vivek/Development/mcp-trader-kit/scripts/setup.sh`

- [ ] **Step 3: Dry-run against a tmp vault**

Run:
```bash
cd /tmp && rm -rf mtk-dryrun && mkdir mtk-dryrun && cd mtk-dryrun
MCP_TRADER_KIT_ROOT=/tmp/mtk-dryrun/kit bash /Users/Vivek/Development/mcp-trader-kit/scripts/setup.sh <<< $'\n'
ls -la /tmp/mtk-dryrun/vault/.claude /tmp/mtk-dryrun/kit/profiles
```
Expected: `vault/.claude/settings.json` exists; `kit/profiles/example-personal.md` + `example-llc.md` exist; `kit/.env` present w/ 600 perms.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat(scripts): interactive setup.sh installer"
```

---

## Task 17: `doctor.sh` health check

**Files:**
- Create: `scripts/doctor.sh`

- [ ] **Step 1: Write doctor.sh**

```bash
#!/usr/bin/env bash
set -u
KIT_ROOT="${MCP_TRADER_KIT_ROOT:-$HOME/.mcp-trader-kit}"
FAIL=0

row() { printf '%-22s %-6s %s\n' "$1" "$2" "$3"; }
pass() { row "$1" "OK" "$2"; }
skip() { row "$1" "SKIP" "$2"; }
fail() { row "$1" "FAIL" "$2"; FAIL=1; }

printf '%-22s %-6s %s\n' "component" "status" "detail"
printf '%-22s %-6s %s\n' "---------" "------" "------"

# kit root
if [[ -d "$KIT_ROOT" ]]; then pass "kit-root" "$KIT_ROOT"; else fail "kit-root" "missing $KIT_ROOT"; fi

# env
if [[ -f "$KIT_ROOT/.env" ]]; then
  perms=$(stat -f '%OLp' "$KIT_ROOT/.env" 2>/dev/null || stat -c '%a' "$KIT_ROOT/.env")
  if [[ "$perms" == "600" ]]; then pass "env-file" "perms 600"; else fail "env-file" "perms $perms (want 600)"; fi
else
  fail "env-file" "missing $KIT_ROOT/.env"
fi

# profiles
count=$(ls "$KIT_ROOT/profiles"/*.md 2>/dev/null | wc -l | tr -d ' ')
if [[ "$count" -ge 1 ]]; then pass "profiles" "$count profile(s)"; else fail "profiles" "no profiles in $KIT_ROOT/profiles"; fi

# hook script
if [[ -x "$KIT_ROOT/scripts/pre-tool-use.js" ]]; then pass "hook-script" "executable"; else fail "hook-script" "missing or not executable"; fi

# trade-guard-mcp binary
if command -v trade-guard-mcp >/dev/null 2>&1; then pass "trade-guard-mcp" "$(which trade-guard-mcp)"; else skip "trade-guard-mcp" "not globally installed (npx -y will resolve)"; fi

# snaptrade-trade-mcp
if command -v snaptrade-trade-mcp >/dev/null 2>&1; then pass "snaptrade-trade-mcp" "installed"; else skip "snaptrade-trade-mcp" "not globally installed"; fi

# snaptrade-mcp-ts
if command -v snaptrade-mcp-ts >/dev/null 2>&1; then pass "snaptrade-mcp-ts" "installed"; else skip "snaptrade-mcp-ts" "not globally installed"; fi

# creds
if [[ -f "$KIT_ROOT/.env" ]] && grep -q '^SNAPTRADE_CONSUMER_KEY=..*$' "$KIT_ROOT/.env"; then
  pass "snaptrade-creds" "set"
else
  fail "snaptrade-creds" "SNAPTRADE_CONSUMER_KEY not set in $KIT_ROOT/.env"
fi

echo
if [[ "$FAIL" -eq 0 ]]; then echo "doctor: all green"; exit 0; else echo "doctor: $FAIL issue(s) found"; exit 1; fi
```

- [ ] **Step 2: Make executable**

Run: `chmod +x /Users/Vivek/Development/mcp-trader-kit/scripts/doctor.sh`

- [ ] **Step 3: Dry-run against the tmp vault from Task 16**

Run: `MCP_TRADER_KIT_ROOT=/tmp/mtk-dryrun/kit bash /Users/Vivek/Development/mcp-trader-kit/scripts/doctor.sh`
Expected: kit-root OK, env-file OK, profiles OK (2 profile(s)), hook-script OK, snaptrade-creds FAIL (placeholder env), exit 1.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "feat(scripts): doctor.sh health check"
```

---

## Task 18: `refresh.sh` portfolio chain

**Files:**
- Create: `scripts/refresh.sh`

- [ ] **Step 1: Write refresh.sh**

```bash
#!/usr/bin/env bash
# scripts/refresh.sh — portfolio refresh prompt. Prints a prompt the user can paste
# into Claude Code to trigger the standard refresh chain. Does NOT call MCPs directly;
# refresh is a Claude-orchestrated flow by design (vault updates + dashboard edits).

cat <<'EOF'
Refresh the portfolio via the standard chain:

1. Call snaptrade_check_status, snaptrade_list_accounts, snaptrade_portfolio_summary.
2. For each brokerage, update wiki/trading/<broker>-portfolio.md.
3. Aggregate into wiki/trading/portfolio-master.md.
4. Update totals + "last refresh" timestamp in wiki/trading/dashboard.md.
5. Flag any position >4h stale with 🟡 in dashboard.md.

Paste the above into Claude Code, or run from any session: "refresh the portfolio now."
EOF
```

- [ ] **Step 2: Make executable + verify**

Run: `chmod +x /Users/Vivek/Development/mcp-trader-kit/scripts/refresh.sh && bash /Users/Vivek/Development/mcp-trader-kit/scripts/refresh.sh | head -3`
Expected: prompt text prints.

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "feat(scripts): refresh.sh emits standard refresh prompt"
```

---

## Task 19: Integration docs

**Files:**
- Create: `docs/brokerages.md`
- Create: `docs/unusual-whales.md`
- Create: `docs/tradestation.md`
- Create: `docs/exa.md`
- Create: `docs/tax-entity.md`
- Create: `docs/risk-gates.md`
- Create: `docs/proposal-ux.md`

- [ ] **Step 1: `docs/brokerages.md`**

```md
# Supported Brokerages (via SnapTrade)

mcp-trader-kit inherits brokerage support from SnapTrade. Tested:

| Broker | Read | Write | Notes |
|---|---|---|---|
| Fidelity (incl. BrokerageLink) | ✅ | ✅ | Equities + options |
| E-Trade | ✅ | ✅ | Partnership/LLC (`INVCLUB_LLC_PARTNERSHIP`) supported via `connection_type=trade` OAuth |
| Robinhood | ✅ | ❌ | SnapTrade code 1063 "does not support trading" |
| IBKR | ✅ | ✅ | Newly live in SnapTrade |
| Schwab | ✅ | ✅ | Standard |
| TradeStation | — | — | Separate MCP (see `tradestation.md`) |
| Ally | ❌ | ❌ | No programmatic path — manual screenshots |
| Morgan Stanley | ❌ | ❌ | No programmatic path |

## Known limitations
- SnapTrade impact endpoints hardcode RTH (error code 1019 "Outside market hours"). Extended-hours requires `equity_force_place` with `trading_session=EXTENDED`.
- Rate limit: 250 req/min (free tier).
- Errors surface via `SnaptradeError.responseBody` — downstream MCPs pass through verbatim.
```

- [ ] **Step 2: `docs/unusual-whales.md`**

```md
# Unusual Whales (optional)

mcp-trader-kit does not ship a UW MCP in v0.1. If you have a UW token and want UW endpoints in Claude Code, wire a UW MCP server separately.

## Token tier
Probe your token against ~39 endpoints to see which tier you're on. Full-tier reaches: `darkpool/recent`, `darkpool/{ticker}`, `option-trades/flow-alerts`, `stock/{t}/flow-alerts`, `stock/{t}/greek-exposure`, `stock/{t}/spot-exposures`, `congress/recent-trades`, `insider/transactions`, `market/fda-calendar`, `screener/{analysts,stocks,option-contracts}`, `news/headlines`, `earnings/{premarket,afterhours,{t}}`, `etfs/{t}/holdings`, `alerts/configuration`.

## Cloudflare gate
Requests with the default `python-urllib` User-Agent get Cloudflare code 1010. Always send a browser UA, e.g. `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36`.

## Base URL
`https://api.unusualwhales.com/api/` with `Authorization: Bearer <UW_TOKEN>`.
```

- [ ] **Step 3: `docs/tradestation.md`**

```md
# TradeStation

TradeStation supplies its own MCP server (install separately). Typical env:

- `TS_CLIENT_ID`, `TS_CLIENT_SECRET`, `TS_REFRESH_TOKEN`
- Standard tools: quotes, option chains, place/cancel orders, account balances.

Register under `mcpServers.tradestation` in `.claude/settings.json`. The trade-guard hook matcher does NOT intercept TradeStation by default — add `mcp__tradestation__place_order` to the matcher if you use TS write tools.
```

- [ ] **Step 4: `docs/exa.md`**

```md
# EXA

Research MCP. Required. Set `EXA_API_KEY` in `~/.mcp-trader-kit/.env`.

Typical tools: `web_search_exa`, `crawling_exa`, `deep_researcher_start`, `deep_researcher_check`.

Use for: news, earnings-call transcripts, catalyst discovery, thesis building.
```

- [ ] **Step 5: `docs/tax-entity.md`**

```md
# Tax entity pooling

Wash-sale aggregation scope is controlled by the `tax_entity` field in each profile.

## Values
- `personal` — all your personal taxable and IRA accounts. (IRS counts IRAs for wash-sale purposes.)
- `llc-bildof`, `llc-innocore` — LLC partnership files its own tax return, separate from your personal return.

Only profiles with the **same** `tax_entity` are pooled. A loss in Fidelity (personal) can wash against a buy in Robinhood (personal) but NOT against Bildof LLC.

## Why option-on-underlying counts
IRS treats options on the same underlying as "substantially identical." trade-guard's wash-sale check flags both: `AAPL` stock ↔ `AAPL C150` option.

## ETF-of-same-index
Debated by IRS guidance. Not currently flagged. If you want this, manually override via the activities feed.
```

- [ ] **Step 6: `docs/risk-gates.md`**

```md
# Risk gates

Enforcement lives in three layers:

1. **CLAUDE.md convention** — model must render a numbered proposal + wait for natural-language approval. Visibility.
2. **PreToolUse hook** — fires on destructive tool calls, invokes `trade-guard.check_trade`, blocks on fail. Hard enforcement.
3. **trade-guard-mcp** — caps (notional, single-name %, forbidden tools/legs) + wash-sale (±30d, tax_entity pool).

## Fail-closed default
If the hook cannot reach trade-guard-mcp or the active profile is unset, the hook blocks by default. Override with `MCP_TRADER_KIT_FAIL_OPEN=true` (not recommended).

## Forbidden leg shapes
Defined in profile YAML. trade-guard inspects args passed to `mleg_place` and rejects if any leg matches a forbidden shape.

## Override path
If a gate blocks a trade you want to make: edit the profile cap, re-run doctor, retry. Gates are configuration, not hardcoded. They fail closed on purpose.
```

- [ ] **Step 7: `docs/proposal-ux.md`**

```md
# Proposal UX

Before emitting a destructive MCP tool, the model renders:

```
PROPOSAL — BILDOF
1. SELL_TO_OPEN 5x AAPL 2026-06 P150 @ $2.40 credit
   Notional (max loss): $72,600 | Wash-sale: clean
   Caps: notional $5k limit — CAP VIOLATION
2. SELL_TO_OPEN 1x AAPL 2026-06 P150 @ $2.40 credit
   Notional (max loss): $14,520 | Wash-sale: clean
   Caps: notional $5k limit — CAP VIOLATION
```

Natural-language approvals the model understands:
- "do #1", "go with 2", "place the first one"
- "skip", "cancel", "never mind"
- "change qty to 1", "try again at $2.50"
- "what's the max loss on 2?"

Only after an explicit approval referring to a specific numbered option does the model emit the actual tool call. The PreToolUse hook still runs on that call.
```

- [ ] **Step 8: Commit**

```bash
git add .
git commit -m "docs: integration + gates + proposal UX documentation"
```

---

## Task 20: Example transcripts

**Files:**
- Create: `examples/bildof-sample-session.md`
- Create: `examples/tlh-walkthrough.md`
- Create: `examples/regime-check.md`

- [ ] **Step 1: `examples/bildof-sample-session.md`**

```md
# Example: Bildof session — open a CC ladder

```
User: switch to bildof
Claude: active profile set to bildof (LLC partnership, $5k notional cap, no naked options).

User: current bildof positions
Claude: [calls snaptrade_get_positions] ... summarizes.

User: sell an AAPL 2026-06 $200 covered call against the 100 shares
Claude:
PROPOSAL — BILDOF
1. SELL_TO_OPEN 1x AAPL 2026-06 C200 @ $3.50 credit
   Notional (collateral-covered): $0 cash risk | Wash-sale: clean
   Caps: covered; not cash-gated — PASS

User: do 1
Claude: [calls mleg_place → hook runs check_trade → PASS → broker returns brokerage_order_id 12345]
Recorded to wiki/trading/trades/2026-04-14.md + wiki/trading/bildof/log.md.
```
```

- [ ] **Step 2: `examples/tlh-walkthrough.md`**

```md
# Example: TLH scan

```
User: what's harvestable in personal?
Claude: [calls trade-guard.scan_tlh({tax_entity: "personal", threshold_usd: 500})]
Candidates (wash-sale-clean, sorted by loss size):
1. AAPL — $2,000 unrealized loss, 100 sh in personal-fid
2. QQQ — $800 unrealized loss, 10 sh in personal-fid

User: harvest AAPL, buy SPY afterward
Claude: caveat: SPY isn't substantially identical to AAPL — fine. Proposing:

PROPOSAL — PERSONAL-FID
1. SELL 100 AAPL @ market
   Unrealized loss: $2,000 (harvestable) | Wash-sale: clean
   Caps: PASS

User: do it
Claude: [mleg/equity_force_place → hook PASS → filled → vault updated]

User: now buy 100 SPY
Claude:
PROPOSAL — PERSONAL-FID
1. BUY 100 SPY @ market (~$480 = $48,000)
   Wash-sale on SPY: clean | Caps: PASS

User: do it
Claude: [force_place → hook PASS → filled → vault updated]
```
```

- [ ] **Step 3: `examples/regime-check.md`**

```md
# Example: Morning regime check

```
User: morning — what's the regime?
Claude: (reads wiki/trading/regime.md + risk-signals.md)
Mode: cautious. Decision: no new aggressive longs. CRI: elevated. VCG: neutral.
Top 3 open questions:
1. TECK covered-call ITM — roll or let called away?
2. COPX concentration >12% in personal — trim?
3. MQ TLH window closes Apr 18.

Want to tackle one?
```
```

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "docs(examples): Bildof CC ladder + TLH walkthrough + regime check transcripts"
```

---

## Task 21: README + SETUP + LICENSE polish

**Files:**
- Create: `README.md`
- Create: `SETUP.md`

- [ ] **Step 1: Write `README.md`**

```md
# mcp-trader-kit

Packaged Claude-Code-as-trading-terminal setup. Clone, run `./scripts/setup.sh`, get:

- **Risk-gated trade execution** — caps, forbidden tools/legs, wash-sale pre-trade check.
- **Obsidian-style vault** for theses, trades, sessions, regime.
- **Multi-account profiles** with `tax_entity`-scoped wash-sale pooling.
- **Staged-proposal UX** — model shows a numbered proposal before every destructive tool, you approve in natural language.
- Works with **SnapTrade-supported brokers** (Fidelity, E-Trade, Robinhood-read-only, IBKR, Schwab), **TradeStation**, **EXA** research, optional **Unusual Whales** and **radon** (IBKR direct).

## ⚠️ Disclaimer

This software places real orders against real brokerage accounts. The authors disclaim all liability for losses, tax consequences, broker-side errors, model hallucinations, or any other outcome of its use. **Not financial advice.** You are responsible for every order approved in the REPL. Test on paper/sandbox accounts first. Do not disable the PreToolUse hook. Do not remove the risk gates.

## Quickstart

```bash
git clone https://github.com/nkrvivek/mcp-trader-kit
cd mcp-trader-kit
npm install
./scripts/setup.sh
# edit ~/.mcp-trader-kit/.env with credentials
# edit ~/.mcp-trader-kit/profiles/*.md with your account_ids
./scripts/doctor.sh
cd vault && claude
```

See [SETUP.md](SETUP.md) for the full walkthrough.

## Architecture

One MCP (`trade-guard-mcp`) + one PreToolUse hook + markdown profiles + a vault template. Works with Claude Code; other MCP clients supported with a bit of wiring (see `docs/`).

## Tested brokers

See [docs/brokerages.md](docs/brokerages.md). TL;DR: SnapTrade covers Fidelity/E-Trade/IBKR/Schwab read+write, Robinhood read-only. TradeStation via its own MCP. Ally/Morgan Stanley manual.

## License

MIT. See [LICENSE](LICENSE).
```

- [ ] **Step 2: Write `SETUP.md`**

```md
# SETUP

## Prerequisites

- macOS or Linux.
- Node 20+.
- Claude Code CLI (`npm i -g @anthropic-ai/claude-code` or equivalent).
- A SnapTrade account with at least one brokerage connected.
- Credentials for: SnapTrade, optionally EXA, TradeStation, Unusual Whales.

## Step 1: Clone + install

```bash
git clone https://github.com/nkrvivek/mcp-trader-kit
cd mcp-trader-kit
npm install
npm run build
```

## Step 2: Run setup.sh

```bash
./scripts/setup.sh
```

The script:
1. Prompts for a vault path (default `./vault`).
2. Copies vault + CLAUDE.md templates.
3. Copies profile templates → `~/.mcp-trader-kit/profiles/`.
4. Copies the hook script → `~/.mcp-trader-kit/scripts/`.
5. Writes `~/.mcp-trader-kit/.env` template (600 perms).
6. Writes `<vault>/.claude/settings.json` (MCP registrations + PreToolUse hook matcher).

## Step 3: Credentials

Edit `~/.mcp-trader-kit/.env`:

```bash
ANTHROPIC_API_KEY=sk-ant-...
SNAPTRADE_CLIENT_ID=...
SNAPTRADE_CONSUMER_KEY=...
SNAPTRADE_USER_ID=...
SNAPTRADE_USER_SECRET=...
EXA_API_KEY=...
UW_TOKEN=...        # optional
```

## Step 4: Profiles

Edit `~/.mcp-trader-kit/profiles/example-personal.md` (rename to e.g. `personal.md`). Replace `account_id` with the UUID from a `snaptrade_list_accounts` call. Set realistic caps.

Repeat for each account. Pool wash-sale scope via `tax_entity`: all personal accounts get `personal`; each LLC gets its own `llc-*`.

## Step 5: Verify

```bash
./scripts/doctor.sh
```

Should be all green except for optional components you haven't installed.

## Step 6: Launch

```bash
cd <vault>
claude
```

On first turn, Claude will read CLAUDE.md + the vault, ask which profile to use, and load context. Ask "list profiles" to confirm trade-guard-mcp is wired.

## Step 7: First trade (paper or sandbox only)

Try: "list positions in `<profile>`", then a small proposal. Verify the hook fires on any destructive tool by watching stderr during the call.

## Troubleshooting

- **Hook never fires:** check `.claude/settings.json` matcher pattern — tool names must start with `mcp__<server-name>__<tool-name>`.
- **Wash-sale check always returns unavailable:** confirm `SNAPTRADE_READ_COMMAND=npx SNAPTRADE_READ_ARGS="-y snaptrade-mcp-ts"` is in the env when trade-guard-mcp launches (Claude Code inherits the project env).
- **Profile not found:** `trade-guard.list_profiles` should show the file name (without `.md`) — if empty, verify YAML frontmatter parses and `MCP_TRADER_KIT_ROOT` points where you think.
```

- [ ] **Step 3: Commit**

```bash
git add .
git commit -m "docs: README + SETUP + quickstart walkthrough"
```

---

## Task 22: Live-trade smoke test script

**Files:**
- Create: `scripts/live-trade-smoke.ts`
- Modify: `package.json` (add `scripts.smoke`)

- [ ] **Step 1: Create smoke script**

```ts
// scripts/live-trade-smoke.ts
// Places $1 order + immediate cancel against a live account.
// Gated by CLITRADER_ALLOW_LIVE=true. DO NOT remove the guard.

if (process.env.CLITRADER_ALLOW_LIVE !== "true") {
  console.error("REFUSING TO RUN: set CLITRADER_ALLOW_LIVE=true to proceed (live order will be placed and canceled).");
  process.exit(1);
}

const ACCOUNT_ID = process.env.SMOKE_ACCOUNT_ID;
const PROFILE = process.env.SMOKE_PROFILE;
if (!ACCOUNT_ID || !PROFILE) {
  console.error("Set SMOKE_ACCOUNT_ID and SMOKE_PROFILE env vars.");
  process.exit(1);
}

console.log(`Smoke test: profile=${PROFILE} account=${ACCOUNT_ID}`);
console.log("1. Invoking trade-guard.check_trade on a $1 SPY BUY (should PASS if caps allow).");
console.log("2. Instructing user to call mcp__snaptrade-trade__equity_force_place from Claude Code.");
console.log("3. User should observe hook emits 'trade-guard: pass' on stderr.");
console.log("4. Immediately cancel via mcp__snaptrade-trade__cancel_order.");
console.log();
console.log("This script does not itself call SnapTrade — it's a guided manual E2E.");
console.log("Run Claude Code in the vault, paste the prompt above, and capture the hook output.");
```

- [ ] **Step 2: Add npm script**

Edit root `package.json`:
```json
"scripts": {
  ...
  "smoke": "tsx scripts/live-trade-smoke.ts"
}
```

And add `tsx` to devDependencies via `npm i -D tsx -w .`

- [ ] **Step 3: Verify guard trips**

Run: `npm run smoke`
Expected: "REFUSING TO RUN: set CLITRADER_ALLOW_LIVE=true..." exit 1.

Run: `CLITRADER_ALLOW_LIVE=true SMOKE_ACCOUNT_ID=x SMOKE_PROFILE=y npm run smoke`
Expected: prints walkthrough, exit 0.

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "chore: guided live-trade smoke script (env-gated)"
```

---

## Task 23: Wire full CI + release prep

**Files:**
- Modify: `.github/workflows/ci.yml` (add coverage upload)
- Create: `.github/workflows/release.yml`
- Modify: `mcp-servers/trade-guard/package.json` (publish config)

- [ ] **Step 1: Update `.github/workflows/ci.yml`**

```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, cache: npm }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run build
      - run: npm run test
      - uses: codecov/codecov-action@v4
        with: { files: mcp-servers/trade-guard/coverage/lcov.info }
```

- [ ] **Step 2: Create `.github/workflows/release.yml`**

```yaml
name: Release trade-guard-mcp
on:
  push:
    tags: ["trade-guard-v*"]
jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20, registry-url: "https://registry.npmjs.org" }
      - run: npm ci
      - run: npm run -w trade-guard-mcp build
      - run: npm publish -w trade-guard-mcp --access public
        env: { NODE_AUTH_TOKEN: "${{ secrets.NPM_TOKEN }}" }
```

- [ ] **Step 3: Update `trade-guard/package.json` publish config**

```json
{
  "name": "trade-guard-mcp",
  ...
  "publishConfig": { "access": "public" },
  "repository": { "type": "git", "url": "git+https://github.com/nkrvivek/mcp-trader-kit.git", "directory": "mcp-servers/trade-guard" },
  "keywords": ["mcp", "trading", "snaptrade", "claude", "risk-gate", "wash-sale"],
  "homepage": "https://github.com/nkrvivek/mcp-trader-kit"
}
```

- [ ] **Step 4: Commit**

```bash
git add .
git commit -m "chore(ci): coverage upload + release workflow for trade-guard-mcp"
```

---

## Task 24: End-to-end dogfood + release v0.1.0

**Files:**
- Modify: `mcp-servers/trade-guard/package.json` (bump version if needed)
- Modify: `CHANGELOG.md` (create)

- [ ] **Step 1: Dogfood against author's real vault**

Manual steps (document outcomes in a temp file, not committed):
1. Run `./scripts/setup.sh` against a fresh dir alongside `/Users/Vivek/Development/obsidian/`.
2. Copy one real profile template; edit with real account_id + tax_entity.
3. Run `./scripts/doctor.sh` — all required green.
4. Launch Claude Code inside the dogfood vault. Verify MCPs list includes `trade-guard`.
5. `trade-guard.list_profiles` → returns your profile.
6. `trade-guard.set_profile {name: "<yours>"}` → active.
7. `trade-guard.check_wash_sale {ticker: "AAPL", action: "BUY", tax_entity: "personal"}` → returns result (flagged or clean).
8. Drive a paper/sandbox order through Claude Code; verify hook stderr appears on the destructive call.
9. Trigger a cap violation intentionally; verify hook blocks with the reason.

- [ ] **Step 2: Create `CHANGELOG.md`**

```md
# Changelog

## [0.1.0] — 2026-04-14

### trade-guard-mcp
- Initial release.
- Tools: `check_trade`, `check_wash_sale`, `scan_tlh`, `list_profiles`, `set_profile`.
- Gates: caps (notional, single-name %, forbidden tools + leg shapes), wash-sale (±30d, tax_entity pool, options-on-underlying).
- Credential redaction on tool responses.

### mcp-trader-kit (repo)
- `setup.sh`, `doctor.sh`, `refresh.sh`, `pre-tool-use.js`.
- Templates: CLAUDE.md, profiles, vault (Obsidian-style wiki/trading/...).
- Docs: brokerages, UW, TradeStation, EXA, tax-entity, risk-gates, proposal-ux.
- Examples: Bildof CC session, TLH walkthrough, morning regime check.
```

- [ ] **Step 3: Tag + release**

```bash
git add .
git commit -m "release: v0.1.0 — initial public release"
git tag trade-guard-v0.1.0
# After pushing to GH with the release workflow set up:
# git push --tags
```

- [ ] **Step 4: Create GH repo + push (user-approved)**

```bash
# Confirm scope with user before running:
gh repo create nkrvivek/mcp-trader-kit --public --source=. --description "Packaged Claude-Code-as-trading-terminal setup with risk gates"
git push -u origin main
git push --tags
```

- [ ] **Step 5: Verify npm publish fires on tag push and binary lands at `npm view trade-guard-mcp`**

---

## Out of v0.1 scope (v0.2 backlog)

- Day-P&L circuit breaker (`max_daily_loss` reads `snaptrade_portfolio_summary` pre-trade).
- Mandatory `[[theses/*]]` link on destructive trades.
- UW MCP wrapper (separate repo).
- radon MCP shim.
- `clitrader` thin CLI wrapper w/ Vercel AI SDK for GPT/Gemini users.
- Binary builds via `bun compile`.
- Automated brokerage MCP installers in `setup.sh`.
