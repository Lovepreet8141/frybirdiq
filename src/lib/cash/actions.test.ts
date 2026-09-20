import { beforeEach, describe, expect, it, vi } from "vitest";
import { fromRupees } from "@/lib/money";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  openCashSession: vi.fn(),
  closeCashSession: vi.fn(),
  recordCashHandover: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/lib/auth", () => ({
  NotSignedIn: class NotSignedIn extends Error {},
  NotPermitted: class NotPermitted extends Error {},
  requirePermission: mocks.requirePermission,
}));
vi.mock("@/lib/repositories/cash-sessions", () => ({ openCashSession: mocks.openCashSession, closeCashSession: mocks.closeCashSession, recordCashHandover: mocks.recordCashHandover }));

import { NotPermitted, NotSignedIn } from "@/lib/auth";
import { closeCashSessionAction, openCashSessionAction, recordCashHandoverAction } from "./actions";

const staff = { userId: "11111111-1111-4111-8111-111111111111", orgId: "22222222-2222-4222-8222-222222222222" };
const idle = { status: "idle" } as const;
const SESSION = "33333333-3333-4333-8333-333333333333";
const RIDER = "44444444-4444-4444-8444-444444444444";
const form = (entries: Record<string, string>) => {
  const data = new FormData();
  for (const [k, v] of Object.entries(entries)) data.append(k, v);
  return data;
};

beforeEach(() => {
  mocks.requirePermission.mockReset().mockResolvedValue(staff);
  mocks.openCashSession.mockReset().mockResolvedValue({ ok: true, sessionId: SESSION });
  mocks.closeCashSession.mockReset().mockResolvedValue({ ok: true, counted: fromRupees("9980"), expected: fromRupees("10000"), variance: fromRupees("-20") });
  mocks.recordCashHandover.mockReset().mockResolvedValue({ ok: true, handoverId: "h", expected: fromRupees("800"), declared: fromRupees("780"), variance: fromRupees("-20"), paymentCount: 2 });
  mocks.revalidatePath.mockReset();
});

describe("who may run the till", () => {
  it.each([
    ["open", () => openCashSessionAction(idle, form({ openingFloat: "2000" }))],
    ["close", () => closeCashSessionAction(idle, form({ sessionId: SESSION, countedCash: "9980" }))],
    ["handover", () => recordCashHandoverAction(idle, form({ riderUserId: RIDER, declaredCash: "780" }))],
  ])("%s asks for finance.manage, and a refusal writes nothing", async (_name, run) => {
    mocks.requirePermission.mockRejectedValue(new NotPermitted("finance.manage"));
    expect(await run()).toEqual({ status: "error", message: "You don't have permission to run the till." });
    expect(mocks.requirePermission).toHaveBeenCalledWith("finance.manage");
    for (const write of [mocks.openCashSession, mocks.closeCashSession, mocks.recordCashHandover]) expect(write).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("a signed-out caller is told to sign in", async () => {
    mocks.requirePermission.mockRejectedValue(new NotSignedIn());
    expect(await openCashSessionAction(idle, form({ openingFloat: "2000" }))).toMatchObject({ status: "error", message: expect.stringContaining("signed out") });
  });
});

describe("openCashSessionAction", () => {
  it("parses the float as money and opens the signed-in staff member's own till, never one named in the form", async () => {
    const result = await openCashSessionAction(idle, form({ openingFloat: "2000.50", note: "Morning", orgId: "99999999-9999-4999-8999-999999999999" }));
    expect(mocks.openCashSession).toHaveBeenCalledWith({ orgId: staff.orgId, actorUserId: staff.userId, openingFloat: fromRupees("2000.50"), note: "Morning" });
    expect(result).toEqual({ status: "success", message: "Till opened with a float of ₹2,000.50." });
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/app/finance");
  });
  it.each(["", "-5", "abc", "12.345", "99999999999"])("refuses a float of %j before anything is written", async (openingFloat) => {
    expect((await openCashSessionAction(idle, form({ openingFloat }))).status).toBe("error");
    expect(mocks.openCashSession).not.toHaveBeenCalled();
  });
  it("a till that is already open comes back as the repository's own words", async () => {
    mocks.openCashSession.mockResolvedValue({ ok: false, code: "ALREADY_OPEN", error: "A till is already open. Close it before opening another." });
    expect(await openCashSessionAction(idle, form({ openingFloat: "2000" }))).toEqual({ status: "error", message: "A till is already open. Close it before opening another." });
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});

describe("closeCashSessionAction", () => {
  it("closes with the counted amount and only THEN says what was expected and the variance in words", async () => {
    const result = await closeCashSessionAction(idle, form({ sessionId: SESSION, countedCash: "9980", note: "" }));
    expect(mocks.closeCashSession).toHaveBeenCalledWith({ orgId: staff.orgId, actorUserId: staff.userId, sessionId: SESSION, counted: fromRupees("9980"), note: null });
    expect(result).toEqual({ status: "success", message: "Till closed. Counted ₹9,980, expected ₹10,000: ₹20 short." });
  });
  it("a malformed session id or amount is refused without touching the repository", async () => {
    expect((await closeCashSessionAction(idle, form({ sessionId: "1 OR 1=1", countedCash: "10" }))).status).toBe("error");
    expect((await closeCashSessionAction(idle, form({ sessionId: SESSION, countedCash: "ten" }))).status).toBe("error");
    expect(mocks.closeCashSession).not.toHaveBeenCalled();
  });
});

describe("recordCashHandoverAction", () => {
  it("records what the rider declared, and says owed, handed over and the difference", async () => {
    const result = await recordCashHandoverAction(idle, form({ riderUserId: RIDER, declaredCash: "780" }));
    expect(mocks.recordCashHandover).toHaveBeenCalledWith({ orgId: staff.orgId, actorUserId: staff.userId, riderUserId: RIDER, declared: fromRupees("780"), note: null });
    expect(result).toEqual({ status: "success", message: "Rider cash received: 2 payments, ₹800 owed, ₹780 handed over: ₹20 short." });
  });
  it("needs a real rider id", async () => {
    expect((await recordCashHandoverAction(idle, form({ riderUserId: "nope", declaredCash: "1" }))).status).toBe("error");
    expect(mocks.recordCashHandover).not.toHaveBeenCalled();
  });
});
