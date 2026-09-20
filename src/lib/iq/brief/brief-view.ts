/**
 * The daily brief, as the page lays it out (IQ-2 S10b): the composed `Brief`
 * turned into ordered sections of plain lines. Pure: no database, no clock, no
 * wording of its own beyond `templates.ts` headings, so the page adds nothing
 * the grounding test has not already scanned.
 */

import { type Brief, type BriefLine } from "./compose";
import { SECTION_COPY } from "./templates";

export interface BriefViewSection {
  readonly id: "yesterday" | "risks" | "worthKnowing" | "treatWithCare" | "footer";
  readonly heading: string;
  readonly subline: string | null;
  readonly lines: readonly BriefViewLine[];
}

export interface BriefViewLine {
  readonly key: string;
  readonly text: string;
  /** 1 to 3 for a finding, null for a plain figure or note. Shown in words, never colour alone. */
  readonly severity: 1 | 2 | 3 | null;
}

const line = (l: BriefLine): BriefViewLine => ({ key: l.key, text: l.text, severity: l.severity });
const present = (lines: readonly (BriefLine | null)[]): BriefViewLine[] => lines.filter((l): l is BriefLine => l !== null).map(line);

export const SEVERITY_WORD: Readonly<Record<1 | 2 | 3, string>> = { 1: "Low", 2: "Medium", 3: "High" };

export function briefSections(brief: Brief): readonly BriefViewSection[] {
  const sections: BriefViewSection[] = [
    { id: "yesterday", heading: SECTION_COPY.yesterday.heading, subline: brief.yesterday.heading.text, lines: brief.yesterday.lines.map(line) },
    {
      id: "risks",
      heading: SECTION_COPY.risks.heading,
      subline: SECTION_COPY.risks.subline,
      lines: present([...brief.risks.lines, brief.risks.more, brief.risks.empty, ...brief.risks.known, ...brief.risks.resolved, brief.restricted]),
    },
    { id: "worthKnowing", heading: SECTION_COPY.worthKnowing.heading, subline: SECTION_COPY.worthKnowing.subline, lines: present([...brief.worthKnowing.lines, brief.worthKnowing.more]) },
    { id: "treatWithCare", heading: SECTION_COPY.treatWithCare.heading, subline: SECTION_COPY.treatWithCare.subline, lines: present([...brief.treatWithCare.lines, brief.treatWithCare.more]) },
    { id: "footer", heading: SECTION_COPY.footer.heading, subline: null, lines: brief.footer.map((text, index) => ({ key: `footer-${index}`, text, severity: null })) },
  ];
  // A section with nothing in it is left out, except Risks, whose empty line is the all-clear (or the honest "not an all-clear").
  return sections.filter((section) => section.lines.length > 0);
}
