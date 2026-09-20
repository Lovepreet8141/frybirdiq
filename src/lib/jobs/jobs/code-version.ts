/**
 * The guard every insight-writing job shares: a run may only record insights
 * when the deploy said which commit it runs.
 *
 * `producedBy.codeVersion` is part of an insight's contract (IQ-ENGINE: a git
 * sha), so a deploy without DEPLOY_COMMIT must fail before it reads anything,
 * with a code that says why, rather than at the write (iq2-s7).
 */

/** Insights record the deployed commit (engine contract: a git sha). */
export const GIT_SHA = /^[0-9a-f]{7,40}$/;

/** The deploy did not say which commit it runs (DEPLOY_COMMIT unset), so no insight could be recorded. */
export class CodeVersionUnknown extends Error {
  readonly code = "CODE_VERSION_UNKNOWN";

  constructor() {
    super("deployed commit unknown");
    this.name = "CodeVersionUnknown";
  }
}

/** Throws CodeVersionUnknown unless `codeVersion` is a git sha. */
export function requireCodeVersion(codeVersion: string): void {
  if (!GIT_SHA.test(codeVersion)) throw new CodeVersionUnknown();
}
