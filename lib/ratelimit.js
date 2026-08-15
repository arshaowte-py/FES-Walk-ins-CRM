/**
 * Small in-memory throttle on the login endpoint.
 *
 * A 4-digit code is only 10,000 guesses, so without this someone with the URL
 * could walk the whole space in minutes. This is per serverless instance rather
 * than global, so it is a speed bump and not a wall — but it turns "minutes to
 * brute force" into "many hours", which is enough for a sale-window tool.
 */
const attempts = new Map();

// Staff at one store share the shop's WiFi, so they share an IP. Set this
// loose enough that a few people fumbling their code don't lock the whole
// store out, tight enough that walking all 10,000 codes takes days.
const WINDOW_MS = 10 * 60 * 1000;
const MAX_FAILURES = 12;

export function checkRateLimit(key) {
  const now = Date.now();
  const rec = attempts.get(key);

  if (!rec || now > rec.resetAt) {
    attempts.set(key, { count: 0, resetAt: now + WINDOW_MS });
    return { allowed: true };
  }

  if (rec.count >= MAX_FAILURES) {
    return {
      allowed: false,
      retryAfterSec: Math.ceil((rec.resetAt - now) / 1000),
    };
  }
  return { allowed: true };
}

export function recordFailure(key) {
  const now = Date.now();
  const rec = attempts.get(key);
  if (!rec || now > rec.resetAt) {
    attempts.set(key, { count: 1, resetAt: now + WINDOW_MS });
  } else {
    rec.count += 1;
  }

  // Keep the map from growing forever on a long-lived instance.
  if (attempts.size > 5000) {
    for (const [k, v] of attempts) if (now > v.resetAt) attempts.delete(k);
  }
}

export function clearFailures(key) {
  attempts.delete(key);
}
