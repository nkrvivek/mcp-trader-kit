import { describe, expect, it } from "vitest";
import { reconcileReminderHandler } from "../../src/tools/reconcile-reminder.js";

const IBKR_OVERDUE = {
  broker: "IBKR",
  order_count: 2,
  session_at: "2026-04-14T18:00:00Z",
  now: "2026-04-16T00:00:00Z",
};

describe("reconcileReminderHandler R5", () => {
  it("emits default query command when overdue", async () => {
    const r = await reconcileReminderHandler(IBKR_OVERDUE);
    expect(r.reminder).toBe(true);
    expect(r.command).toMatch(/--query-id 1448871$/);
  });

  it("accepts numeric flex_query_id", async () => {
    const r = await reconcileReminderHandler({ ...IBKR_OVERDUE, flex_query_id: "1471792" });
    expect(r.command).toMatch(/--query-id 1471792$/);
  });

  it("rejects shell metachars in flex_query_id (command injection)", async () => {
    await expect(
      reconcileReminderHandler({ ...IBKR_OVERDUE, flex_query_id: "1448871; rm -rf ~" })
    ).rejects.toThrow();
    await expect(
      reconcileReminderHandler({ ...IBKR_OVERDUE, flex_query_id: "$(whoami)" })
    ).rejects.toThrow();
    await expect(
      reconcileReminderHandler({ ...IBKR_OVERDUE, flex_query_id: "`id`" })
    ).rejects.toThrow();
    await expect(
      reconcileReminderHandler({ ...IBKR_OVERDUE, flex_query_id: "abc" })
    ).rejects.toThrow();
  });

  it("skips command for non-IBKR broker", async () => {
    const r = await reconcileReminderHandler({ ...IBKR_OVERDUE, broker: "snaptrade" });
    expect(r.command).toBeNull();
  });

  it("skips command when under SLA", async () => {
    const r = await reconcileReminderHandler({
      ...IBKR_OVERDUE,
      now: "2026-04-14T20:00:00Z",
    });
    expect(r.reminder).toBe(false);
    expect(r.command).toBeNull();
  });
});
