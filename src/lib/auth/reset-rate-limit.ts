import "server-only";

/**
 * Rate limiting for the staff/owner password-reset flow — per email and per
 * IP, for both requesting a reset code and checking one.
 *
 * Deliberately its own module with its own `Map`s, not shared with
 * `src/lib/customer/auth-rate-limit.ts` (customer signup/sign-in) — each
 * flow's limits stay independently auditable, and a change here can never
 * regress another flow's own tested behavior. The generic shape (rolling
 * window + minimum gap, in-process, swept lazily) is intentionally the
 * same, for the same reason that module gives: one Node process on one
 * VPS, no second instance to keep a shared store in sync with, and
 * Supabase's own server-side limit is the backstop that survives a restart
 * regardless.
 *
 * Never logs the email or the IP by value — callers log only the fact of a
 * refusal, never these keys.
 */

interface Bucket {
  count: number;
  windowStart: number;
}

const windows = new Map<string, Bucket>();
const lastSentAt = new Map<string, number>();

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
 * Before calling `resetPasswordForEmail`: a 60-second minimum gap per email
 * (enforced server-side, not just a disabled button), then a cap on how
 * many reset codes one email, or one IP, may request in 15 minutes.
 */
export function checkResetRequestLimit(email: string, ip: string | null): RateLimitResult {
  const now = Date.now();
  sweepWindows(now, Math.max(REQUEST_EMAIL_WINDOW_MS, REQUEST_IP_WINDOW_MS, VERIFY_EMAIL_WINDOW_MS, VERIFY_IP_WINDOW_MS));
  sweepLastSent(now, RESEND_MIN_GAP_MS * 10);

  const emailKey = email.toLowerCase();

  const gap = checkGap(emailKey, RESEND_MIN_GAP_MS, now);
  if (!gap.allowed) return gap;

  if (ip) {
    const ipResult = takeWindow(`reset-req:ip:${ip}`, REQUEST_IP_LIMIT, REQUEST_IP_WINDOW_MS, now);
    if (!ipResult.allowed) return ipResult;
  }

  const windowResult = takeWindow(`reset-req:email:${emailKey}`, REQUEST_EMAIL_LIMIT, REQUEST_EMAIL_WINDOW_MS, now);
  if (!windowResult.allowed) return windowResult;

  lastSentAt.set(emailKey, now);
  return { allowed: true };
}

/**
 * Before calling `verifyOtp(type: 'recovery')`: a six-digit reset code is
 * only as safe as the number of guesses allowed against it. Checked on
 * every attempt, right or wrong; never touches the request-side gap above,
 * so a wrong guess can never block requesting a fresh code.
 */
export function checkResetVerifyLimit(email: string, ip: string | null): RateLimitResult {
  const now = Date.now();
  sweepWindows(now, Math.max(REQUEST_EMAIL_WINDOW_MS, REQUEST_IP_WINDOW_MS, VERIFY_EMAIL_WINDOW_MS, VERIFY_IP_WINDOW_MS));

  if (ip) {
    const ipResult = takeWindow(`reset-verify:ip:${ip}`, VERIFY_IP_LIMIT, VERIFY_IP_WINDOW_MS, now);
    if (!ipResult.allowed) return ipResult;
  }

  return takeWindow(`reset-verify:email:${email.toLowerCase()}`, VERIFY_EMAIL_LIMIT, VERIFY_EMAIL_WINDOW_MS, now);
}

/** Test-only: clears every bucket between test cases. Never called from application code. */
export function resetResetRateLimitsForTests(): void {
  windows.clear();
  lastSentAt.clear();
}
