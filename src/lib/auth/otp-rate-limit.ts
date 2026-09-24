import "server-only";

/**
 * Rate limiting for the customer email-OTP login flow — per email and per
 * IP, for both sending a code and checking one.
 *
 * In-process memory, not Postgres or Redis: this app is one Node process on
 * one VPS (docs/DEPLOY.md's whole deploy model has no second instance to
 * keep in sync), so a Map is the correct store here, not a shortcut — adding
 * a table or an external store would only be for surviving a restart, and a
 * deploy is not an attacker's clock. Supabase's own server-side rate limit
 * is the backstop that *does* survive a restart; this is the layer in front
 * of it, tuned for this app's own abuse shapes (one inbox bombed, one
 * six-digit code guessed).
 *
 * Never logs the email or the IP by value — callers log only the fact of a
 * refusal, never these keys.
 */

interface Bucket {
  count: number;
  windowStart: number;
}

/** Rolling per-window counters (the 5-in-15-minutes, 20-in-15-minutes style limits). */
const windows = new Map<string, Bucket>();
/** The last successful send per email, for the 60-second minimum gap — deliberately a separate map from
 * `windows` above: a rolling window's own bucket does not move its `windowStart` on every call inside the
 * window, so reusing it for "seconds since the last request" would only be accurate for the first request
 * in each 15-minute window and silently stop enforcing the gap after that. */
const lastSentAt = new Map<string, number>();

/** Bounds memory under sustained abuse: swept lazily, only when a map has grown large enough to matter. */
const SWEEP_ABOVE = 5_000;

function sweepWindows(now: number, maxWindowMs: number): void {
  if (windows.size <= SWEEP_ABOVE) return;
  for (const [key, bucket] of windows) {
    if (now - bucket.windowStart > maxWindowMs) windows.delete(key);
  }
}

function sweepLastSent(now: number, maxAgeMs: number): void {
  if (lastSentAt.size <= SWEEP_ABOVE) return;
  for (const [key, at] of lastSentAt) {
    if (now - at > maxAgeMs) lastSentAt.delete(key);
  }
}

export type RateLimitResult = { readonly allowed: true } | { readonly allowed: false; readonly retryAfterSeconds: number };

function takeWindow(key: string, limit: number, windowMs: number, now: number): RateLimitResult {
  const bucket = windows.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    windows.set(key, { count: 1, windowStart: now });
    return { allowed: true };
  }
  if (bucket.count >= limit) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - bucket.windowStart)) / 1000)) };
  }
  bucket.count += 1;
  return { allowed: true };
}

function checkGap(key: string, minGapMs: number, now: number): RateLimitResult {
  const last = lastSentAt.get(key);
  if (last === undefined) return { allowed: true };
  const elapsed = now - last;
  if (elapsed < minGapMs) return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((minGapMs - elapsed) / 1000)) };
  return { allowed: true };
}

const RESEND_MIN_GAP_MS = 60_000;
const REQUEST_EMAIL_LIMIT = 5;
const REQUEST_EMAIL_WINDOW_MS = 15 * 60_000;
const REQUEST_IP_LIMIT = 20;
const REQUEST_IP_WINDOW_MS = 15 * 60_000;
const VERIFY_EMAIL_LIMIT = 10;
const VERIFY_EMAIL_WINDOW_MS = 15 * 60_000;
const VERIFY_IP_LIMIT = 40;
const VERIFY_IP_WINDOW_MS = 15 * 60_000;

/**
 * Before calling `signInWithOtp`: refuses a resend inside the 60-second
 * window (the card's own number, enforced server-side — a client-side
 * countdown alone is not authorization), then caps how many codes one
 * email, or one IP, may request in 15 minutes. IP is optional: a caller
 * with none (a test, a misconfigured proxy) still gets the email-scoped
 * limits. `lastSentAt` for the 60-second gap is only recorded once every
 * check has actually passed — a refusal must never itself start the clock.
 */
export function checkOtpRequestLimit(email: string, ip: string | null): RateLimitResult {
  const now = Date.now();
  sweepWindows(now, Math.max(REQUEST_EMAIL_WINDOW_MS, REQUEST_IP_WINDOW_MS, VERIFY_EMAIL_WINDOW_MS, VERIFY_IP_WINDOW_MS));
  sweepLastSent(now, RESEND_MIN_GAP_MS * 10);

  const emailKey = email.toLowerCase();

  const gap = checkGap(emailKey, RESEND_MIN_GAP_MS, now);
  if (!gap.allowed) return gap;

  if (ip) {
    const ipResult = takeWindow(`req:ip:${ip}`, REQUEST_IP_LIMIT, REQUEST_IP_WINDOW_MS, now);
    if (!ipResult.allowed) return ipResult;
  }

  const windowResult = takeWindow(`req:email:${emailKey}`, REQUEST_EMAIL_LIMIT, REQUEST_EMAIL_WINDOW_MS, now);
  if (!windowResult.allowed) return windowResult;

  lastSentAt.set(emailKey, now);
  return { allowed: true };
}

/**
 * Before calling `verifyOtp`: a six-digit code is only as safe as the
 * number of guesses allowed against it. Checked on every attempt, right or
 * wrong — only the caller decides whether a wrong code also counts as a
 * request against the resend gap (it does not: guessing wrong must never
 * block requesting a fresh code — `checkOtpVerifyLimit` never touches
 * `lastSentAt`).
 */
export function checkOtpVerifyLimit(email: string, ip: string | null): RateLimitResult {
  const now = Date.now();
  sweepWindows(now, Math.max(REQUEST_EMAIL_WINDOW_MS, REQUEST_IP_WINDOW_MS, VERIFY_EMAIL_WINDOW_MS, VERIFY_IP_WINDOW_MS));

  if (ip) {
    const ipResult = takeWindow(`verify:ip:${ip}`, VERIFY_IP_LIMIT, VERIFY_IP_WINDOW_MS, now);
    if (!ipResult.allowed) return ipResult;
  }

  return takeWindow(`verify:email:${email.toLowerCase()}`, VERIFY_EMAIL_LIMIT, VERIFY_EMAIL_WINDOW_MS, now);
}

/** Test-only: clears every bucket between test cases. Never called from application code. */
export function resetOtpRateLimitsForTests(): void {
  windows.clear();
  lastSentAt.clear();
}
