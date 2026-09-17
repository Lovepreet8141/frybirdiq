/**
 * The fact tables constrain the shape of catalog ids and the unit and grade
 * vocabularies (migration 0036). This keeps them in step with
 * src/lib/iq/metrics/catalog.ts.
 */
import { describe, expect, it } from "vitest";
import {
  DERIVED_METRIC_IDS,
  METRIC_CATALOG,
  METRIC_DIMENSIONS,
  METRIC_UNITS,
  NO_PRODUCT_DIMENSION_VALUE,
  FEES_DIMENSION_VALUE,
  STORED_METRIC_IDS,
  TRUST_SIGNAL_IDS,
} from "@/lib/iq/metrics/catalog";
import { IQ_FACT_ID_PATTERN, IQ_FACT_UNITS, IQ_TRUST_GRADES } from "./iq-facts";

const sorted = (values: readonly string[]) => [...values].sort();
const idPattern = new RegExp(IQ_FACT_ID_PATTERN);

describe("iq fact tables match the metrics catalog", () => {
  it("fact units are the stored metric units", () => {
    expect(sorted(IQ_FACT_UNITS)).toEqual(sorted(METRIC_UNITS));
    for (const id of STORED_METRIC_IDS) expect(IQ_FACT_UNITS).toContain(METRIC_CATALOG[id].unit);
  });

  it("every stored metric, dimension key and trust signal id is storable", () => {
    for (const id of [...STORED_METRIC_IDS, ...DERIVED_METRIC_IDS, ...METRIC_DIMENSIONS, ...TRUST_SIGNAL_IDS]) {
      expect([id, idPattern.test(id)]).toEqual([id, true]);
    }
  });

  it("the reserved dimension values fit the 1..200 character rule", () => {
    for (const value of [FEES_DIMENSION_VALUE, NO_PRODUCT_DIMENSION_VALUE]) expect(value.length).toBeGreaterThan(0);
  });

  it("trust grades are HIGH, MEDIUM, LOW, UNKNOWN", () => {
    expect(IQ_TRUST_GRADES).toEqual(["HIGH", "MEDIUM", "LOW", "UNKNOWN"]);
  });
});
