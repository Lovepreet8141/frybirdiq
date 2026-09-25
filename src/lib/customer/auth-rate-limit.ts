import "server-only";

/**
 * Rate limiting for customer password auth (auth-v3): signing up, verifying
 * (or resending) a signup-confirmation code, and signing in with a password.
 *
 * Its own module with its own `Map`s, not a shared import from
 * `src/lib/auth/reset-rate-limit.ts` — same reasoning that module gives:
 * each flow's limits stay independently auditable, and a change here can
 * never regress an already-reviewed flow's tested behavior. In-process, not
 * Postgres or Redis, for the same "one Node process on one VPS" reason that
 * module states.
 *
 * `checkSignInLimit` is this app's actual defense against password brute
 * force / credential stuffing — a min-8-character password is not made
 * computationally hard to guess by a rate limit; what this blunts is an
 * attacker trying a list of known email/password pairs (leaked elsewhere)
 * against this account. It is checked on EVERY attempt, right or wrong,
 * before Supabase is ever asked — same discipline as a code-verify limiter.
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
const SIGNUP_EMAIL_LIMIT = 5;
const SIGNUP_EMAIL_WINDOW_MS = 15 * 60_000;
const SIGNUP_IP_LIMIT = 20;
const SIGNUP_IP_WINDOW_MS = 15 * 60_000;
const SIGNUP_VERIFY_EMAIL_LIMIT = 10;
const SIGNUP_VERIFY_EMAIL_WINDOW_MS = 15 * 60_000;
const SIGNUP_VERIFY_IP_LIMIT = 40;
const SIGNUP_VERIFY_IP_WINDOW_MS = 15 * 60_000;
/** Tighter than a code-guess limit: a password isn't rotated every attempt, so fewer tries before a cooldown. */
const SIGNIN_EMAIL_LIMIT = 8;
const SIGNIN_EMAIL_WINDOW_MS = 15 * 60_000;
const SIGNIN_IP_LIMIT = 30;
const SIGNIN_IP_WINDOW_MS = 15 * 60_000;

const ALL_WINDOWS_MS = Math.max(
  SIGNUP_EMAIL_WINDOW_MS,
  SIGNUP_IP_WINDOW_MS,
  SIGNUP_VERIFY_EMAIL_WINDOW_MS,
  SIGNUP_VERIFY_IP_WINDOW_MS,
  SIGNIN_EMAIL_WINDOW_MS,
  SIGNIN_IP_WINDOW_MS,
);

/**
 * Before `signUp()` and before `resend({ type: 'signup' })` — both send an
 * email, so both share this limiter, keyed identically: a 60-second gap per
 * email, then a cap per email and per IP in 15 minutes.
 */
export function checkSignupLimit(email: string, ip: string | null): RateLimitResult {
  const now = Date.now();
  sweepWindows(now, ALL_WINDOWS_MS);
  sweepLastSent(now, RESEND_MIN_GAP_MS * 10);

  const emailKey = email.toLowerCase();

  const gap = checkGap(emailKey, RESEND_MIN_GAP_MS, now);
  if (!gap.allowed) return gap;

  if (ip) {
    const ipResult = takeWindow(`signup-req:ip:${ip}`, SIGNUP_IP_LIMIT, SIGNUP_IP_WINDOW_MS, now);
    if (!ipResult.allowed) return ipResult;
  }

  const windowResult = takeWindow(`signup-req:email:${emailKey}`, SIGNUP_EMAIL_LIMIT, SIGNUP_EMAIL_WINDOW_MS, now);
  if (!windowResult.allowed) return windowResult;

  lastSentAt.set(emailKey, now);
  return { allowed: true };
}

/** Before `verifyOtp({ type: 'signup' })`: checked on every attempt, right or wrong. */
export function checkSignupVerifyLimit(email: string, ip: string | null): RateLimitResult {
  const now = Date.now();
  sweepWindows(now, ALL_WINDOWS_MS);

  if (ip) {
    const ipResult = takeWindow(`signup-verify:ip:${ip}`, SIGNUP_VERIFY_IP_LIMIT, SIGNUP_VERIFY_IP_WINDOW_MS, now);
    if (!ipResult.allowed) return ipResult;
  }

  return takeWindow(`signup-verify:email:${emailKey(email)}`, SIGNUP_VERIFY_EMAIL_LIMIT, SIGNUP_VERIFY_EMAIL_WINDOW_MS, now);
}

/**
 * Before `signInWithPassword()`: checked on every attempt, right or wrong,
 * so a failed guess counts the same as a successful one — an attacker cannot
 * learn anything from which attempts get rate-limited sooner.
 */
export function checkSignInLimit(email: string, ip: string | null): RateLimitResult {
  const now = Date.now();
  sweepWindows(now, ALL_WINDOWS_MS);

  if (ip) {
    const ipResult = takeWindow(`signin:ip:${ip}`, SIGNIN_IP_LIMIT, SIGNIN_IP_WINDOW_MS, now);
    if (!ipResult.allowed) return ipResult;
  }

  return takeWindow(`signin:email:${emailKey(email)}`, SIGNIN_EMAIL_LIMIT, SIGNIN_EMAIL_WINDOW_MS, now);
}

function emailKey(email: string): string {
  return email.toLowerCase();
}

/** Test-only: clears every bucket between test cases. Never called from application code. */
export function resetCustomerAuthRateLimitsForTests(): void {
  windows.clear();
  lastSentAt.clear();
}
