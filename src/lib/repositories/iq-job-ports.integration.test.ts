/**
 * The job-runner read ports added in iq2-adapt, against a real database: the
 * daily brief's figures (S10) and the service pulse's four reads (S9).
 *
 * What is checked here is what only the database can answer — the right
 * columns, the bucket arithmetic, the sale set, and that every read stays
 * inside the org it was bound to. The derivation itself is unit-tested in
 * src/lib/jobs/brief-figures.test.ts.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { organizations } from "@/db/schema";
import { briefPeriods } from "@/lib/iq/brief/brief-job";
import { recomputeDay, rebuildIntradayDay } from "./iq-facts";
import { computeTrustDay } from "./iq-trust";
import { iqRepos } from "./iq-job-runs";
import { warmPool } from "./__test-support__/fixtures";
import { createTwoTestOrgs, istInstant, seedSale, type TwoOrgs } from "./__test-support__/iq-fixtures";

const DAY = "2026-09-10";
const BURGER = { unitPricePaise: 17_900n } as const; // taxable 17,048

const at = (time: string, date = DAY) => istInstant(date, time);

describe("job read ports (IQ-2 S9/S10)", () => {
  let orgs: TwoOrgs;

  beforeAll(async () => {
    await warmPool();
    orgs = await createTwoTestOrgs();
    // Org A: two sales in the 12:00 bucket, one in 13:15. Org B: one sale, same day.
    await seedSale(orgs.a, { at: at("12:07"), lines: [BURGER] });
    await seedSale(orgs.a, { at: at("12:10"), lines: [BURGER] });
    await seedSale(orgs.a, { at: at("13:15"), lines: [BURGER] });
    await seedSale(orgs.b, { at: at("12:07"), lines: [BURGER] });
    for (const org of [orgs.a, orgs.b]) {
      await recomputeDay(org.orgId, DAY);
      await computeTrustDay(org.orgId, DAY);
      await rebuildIntradayDay(org.orgId, DAY);
    }
  }, 60_000);

  afterAll(async () => {
    await orgs.cleanup();
  });

  describe("readBriefFigures", () => {
    it("reads the day's figures with their trust, and the month spans as sums", async () => {
      const read = await iqRepos(orgs.a.orgId).readBriefFigures(briefPeriods(DAY));
      // 3 sales × 17,048 taxable.
      expect(read.day.revenue_net?.value).toEqual({ unit: "paise", value: "51144" });
      expect(read.day.orders_paid?.value).toEqual({ unit: "count", value: 3 });
      expect(read.day.net_collected?.value).toEqual({ unit: "paise", value: "53700" }); // 3 × 17,900 captured, no refunds
      expect(read.day.revenue_net?.trust.signalId).not.toBeUndefined();
      // The month to date ends on the day itself, so it sums to the same figure here.
      expect(read.monthToDate?.value).toEqual({ unit: "paise", value: "51144" });
      // No facts exist for last month at all.
      expect(read.sameDaysLastMonth).toBeNull();
    });

    it("never reads another org's facts", async () => {
      const read = await iqRepos(orgs.b.orgId).readBriefFigures(briefPeriods(DAY));
      expect(read.day.revenue_net?.value).toEqual({ unit: "paise", value: "17048" });
    });
  });

  describe("the pulse's reads", () => {
    it("reads the org's stored opening hours", async () => {
      await db().update(organizations).set({ openingTime: "10:00", closingTime: "22:30" }).where(eq(organizations.id, orgs.a.orgId));
      expect(await iqRepos(orgs.a.orgId).readOpeningHours()).toEqual({ opening: "10:00", closing: "22:30" });
    });

    it("turns stored buckets into minutes of the IST day, per org", async () => {
      const [day] = await iqRepos(orgs.a.orgId).readPulseDays([DAY]);
      expect(day?.computed).toBe(true);
      // 12:00 IST = minute 720, and both sales in that quarter are one bucket.
      const noon = day?.buckets.find((bucket) => bucket.startMinute === 720);
      expect(noon?.ordersPaid).toEqual({ unit: "count", value: 2 });
      expect(day?.buckets.find((bucket) => bucket.startMinute === 795)?.ordersPaid).toEqual({ unit: "count", value: 1 });
      const [other] = await iqRepos(orgs.b.orgId).readPulseDays([DAY]);
      expect(other?.buckets.find((bucket) => bucket.startMinute === 720)?.ordersPaid).toEqual({ unit: "count", value: 1 });
    });

    it("reports a day with no intraday rows as not computed, so it never joins a baseline", async () => {
      const [day] = await iqRepos(orgs.a.orgId).readPulseDays(["2026-09-09"]);
      expect(day).toMatchObject({ date: "2026-09-09", computed: false, buckets: [] });
    });

    it("counts paid orders over the sale set in [from, to), per org", async () => {
      const repos = iqRepos(orgs.a.orgId);
      expect(await repos.countPaidOrders("2026-09-10T12:00:00+05:30", "2026-09-10T13:00:00+05:30")).toEqual({ unit: "count", value: 2 });
      // Exclusive end: the 13:15 sale is outside a window that ends at 13:15.
      expect(await repos.countPaidOrders("2026-09-10T13:00:00+05:30", "2026-09-10T13:15:00+05:30")).toEqual({ unit: "count", value: 0 });
      expect(await iqRepos(orgs.b.orgId).countPaidOrders("2026-09-10T12:00:00+05:30", "2026-09-10T13:00:00+05:30")).toEqual({ unit: "count", value: 1 });
    });
  });
});
