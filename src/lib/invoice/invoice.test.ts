import { describe, expect, it } from "vitest";
import { financialYear, invoiceNumber, parseInvoiceNumber } from "./index";

describe("financial year", () => {
  it("starts in April", () => {
    expect(financialYear(new Date("2026-04-01T00:00:00+05:30"))).toBe("2026-27");
    expect(financialYear(new Date("2026-09-10T12:00:00+05:30"))).toBe("2026-27");
    expect(financialYear(new Date("2026-12-31T23:59:00+05:30"))).toBe("2026-27");
  });

  it("puts January to March in the year that began the previous April", () => {
    // The trap: 1 January 2027 is still FY 2026-27. Treating it as 2027-28
    // restarts the series three months early and breaks the sequence.
    expect(financialYear(new Date("2027-01-01T00:00:00+05:30"))).toBe("2026-27");
    expect(financialYear(new Date("2027-03-31T00:00:00+05:30"))).toBe("2026-27");
    expect(financialYear(new Date("2027-04-01T00:00:00+05:30"))).toBe("2027-28");
  });

  it("rolls the century correctly", () => {
    expect(financialYear(new Date("2099-05-01T00:00:00+05:30"))).toBe("2099-00");
  });

  it("turns the year at midnight in Ambala, not on the server", () => {
    // 31 March 2027, 23:30 IST is still 18:00 UTC on the 31st — same year
    // either way. Half an hour later it is 1 April in Ambala but still
    // 31 March in UTC, and a server reading its own clock would file the
    // invoice into the closing year.
    expect(financialYear(new Date("2027-03-31T23:30:00+05:30"))).toBe("2026-27");
    expect(financialYear(new Date("2027-04-01T00:30:00+05:30"))).toBe("2027-28");

    // The same instant, expressed in UTC, must give the same answer.
    expect(financialYear(new Date("2027-03-31T19:00:00Z"))).toBe("2027-28");
  });
});

describe("invoice number", () => {
  it("pads the sequence so numbers sort", () => {
    const date = new Date("2026-09-10T12:00:00+05:30");
    expect(invoiceNumber(date, 1)).toBe("2026-27/0001");
    expect(invoiceNumber(date, 42)).toBe("2026-27/0042");
    expect(invoiceNumber(date, 1234)).toBe("2026-27/1234");
  });

  it("keeps going past the padding rather than truncating", () => {
    expect(invoiceNumber(new Date("2026-09-10T12:00:00+05:30"), 12345)).toBe("2026-27/12345");
  });

  it("refuses a sequence that is not a counting number", () => {
    const date = new Date("2026-09-10T12:00:00+05:30");
    expect(() => invoiceNumber(date, 0)).toThrow(/not a sequence number/);
    expect(() => invoiceNumber(date, -1)).toThrow(/not a sequence number/);
    expect(() => invoiceNumber(date, 1.5)).toThrow(/not a sequence number/);
  });

  it("round-trips", () => {
    const value = invoiceNumber(new Date("2026-09-10T12:00:00+05:30"), 7);
    expect(parseInvoiceNumber(value)).toEqual({ financialYear: "2026-27", sequence: 7 });
  });

  it("returns null for something that is not an invoice number", () => {
    expect(parseInvoiceNumber("004")).toBeNull();
    expect(parseInvoiceNumber("")).toBeNull();
  });
});
