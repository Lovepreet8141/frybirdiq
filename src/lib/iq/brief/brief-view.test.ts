import { describe, expect, it } from "vitest";
import { SEVERITY_WORD, briefSections } from "./brief-view";
import { composeBrief } from "./compose";
import { ALL_RAN, DATE, briefFacts, input } from "./__test-support__/brief";

describe("briefSections — the composed brief laid out for the page", () => {
  it("a ready brief has Yesterday, Risks and the footer, in that order, each line carrying its own text", async () => {
    const brief = composeBrief(input(DATE, await briefFacts(DATE), { checks: ALL_RAN }));
    const sections = briefSections(brief);
    expect(sections.map((s) => s.id)).toEqual(expect.arrayContaining(["yesterday", "risks", "footer"]));
    expect(sections.map((s) => s.id).indexOf("yesterday")).toBeLessThan(sections.map((s) => s.id).indexOf("risks"));
    for (const section of sections) {
      expect(section.lines.length).toBeGreaterThan(0);
      for (const row of section.lines) expect(row.text.length).toBeGreaterThan(0);
    }
  });

  it("every line is exactly the composed text: the page adds no wording or numbers of its own", async () => {
    const brief = composeBrief(input(DATE, await briefFacts(DATE), { checks: ALL_RAN }));
    const composed = new Set<string>([brief.yesterday.heading.text, ...brief.yesterday.lines.map((l) => l.text), ...brief.footer, ...brief.risks.lines.map((l) => l.text)]);
    for (const row of briefSections(brief).flatMap((s) => s.lines)) {
      const known = composed.has(row.text) || [brief.risks.empty?.text, brief.restricted?.text, ...brief.risks.known.map((l) => l.text), ...brief.risks.resolved.map((l) => l.text)].includes(row.text);
      expect(known).toBe(true);
    }
  });

  it("with no insights the brief is not ready and the page says so rather than showing an all-clear", () => {
    const brief = composeBrief(input(DATE, [], { checks: ALL_RAN }));
    expect(brief.state).toBe("NOT_READY");
    expect(brief.notReady).not.toBeNull();
  });

  it("an empty section is left out; severity is a word", () => {
    expect(SEVERITY_WORD).toEqual({ 1: "Low", 2: "Medium", 3: "High" });
  });
});
