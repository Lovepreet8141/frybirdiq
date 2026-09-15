import { describe, expect, it } from "vitest";
import { csvCell, toCsv } from "./csv";

describe("csvCell", () => {
  it("passes plain text through unquoted", () => {
    expect(csvCell("Chicken")).toBe("Chicken");
    expect(csvCell(299)).toBe("299");
  });

  it("renders null and undefined as an empty cell", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
  });

  it("quotes a value with a comma, a quote or a newline", () => {
    expect(csvCell("Ambala, Haryana")).toBe('"Ambala, Haryana"');
    expect(csvCell('12" pizza')).toBe('"12"" pizza"');
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
  });
});

describe("toCsv", () => {
  it("builds a header and rows, CRLF-joined, trailing newline", () => {
    const csv = toCsv(
      ["name", "amount"],
      [
        ["Nashville Bomb", 299],
        ["Combo, Large", 499],
      ],
    );
    expect(csv).toBe('name,amount\r\nNashville Bomb,299\r\n"Combo, Large",499\r\n');
  });

  it("renders an empty body as just the header", () => {
    expect(toCsv(["a", "b"], [])).toBe("a,b\r\n");
  });
});
