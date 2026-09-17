/**
 * Content hash — the identity of what an insight says.
 *
 * DESIGN-v2-DELTA.md §1 and §3: a job that re-derives the same payload and
 * evidence produces the same hash and writes nothing; a different hash on an
 * insight nothing references yet updates it; on a referenced one it
 * supersedes. That only works if the hash is canonical, so:
 *
 * - object keys are sorted, at every depth;
 * - absent and `undefined` fields are the same thing;
 * - evidence is a set — its order does not change the hash;
 * - anything JSON cannot say exactly (bigint, NaN, Infinity, Date, functions)
 *   is refused rather than coerced. Money is already a paise string.
 *
 * Uses Web Crypto, which Node, browsers and edge runtimes all provide, so this
 * module stays free of `node:` imports.
 */
import type { Evidence } from "./evidence";

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError(`canonicalJson: ${value} has no exact JSON form`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value
      .map((item) => {
        if (item === undefined) throw new TypeError("canonicalJson: an array cannot hold undefined");
        return canonicalJson(item);
      })
      .join(",")}]`;
  }
  if (typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  throw new TypeError(`canonicalJson: cannot encode a ${typeof value === "object" ? "non-plain object" : typeof value}`);
}

/** The exact string that is hashed: `{"evidence":[…sorted…],"payload":{…}}`. */
export function contentHashInput(content: { payload: unknown; evidence: readonly Evidence[] }): string {
  const evidence = content.evidence.map((e) => canonicalJson(e)).sort();
  return `{"evidence":[${evidence.join(",")}],"payload":${canonicalJson(content.payload)}}`;
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function computeContentHash(content: { payload: unknown; evidence: readonly Evidence[] }): Promise<string> {
  return sha256Hex(contentHashInput(content));
}

export async function hasValidContentHash(insight: {
  payload: unknown;
  evidence: readonly Evidence[];
  contentHash: string;
}): Promise<boolean> {
  return (await computeContentHash(insight)) === insight.contentHash;
}
