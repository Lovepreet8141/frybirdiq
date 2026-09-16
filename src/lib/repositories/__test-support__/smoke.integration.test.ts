import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestOrg, deleteTestOrg, type TestOrg } from "./fixtures";

describe("integration test infrastructure smoke test", () => {
  let org: TestOrg;

  beforeAll(async () => {
    org = await createTestOrg();
  });

  afterAll(async () => {
    await deleteTestOrg(org.orgId);
  });

  it("can create and read back a real organization against the local database", () => {
    expect(org.orgId).toBeTruthy();
    expect(org.locationId).toBeTruthy();
  });
});
