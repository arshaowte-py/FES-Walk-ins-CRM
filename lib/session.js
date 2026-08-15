import crypto from "crypto";
import { cookies } from "next/headers";

const STORE_COOKIE = "frido_store";
const ADMIN_COOKIE = "frido_admin";

const STORE_MAX_AGE = 60 * 60 * 12; // 12h — one working day, then they log in again.
const ADMIN_MAX_AGE = 60 * 60 * 8; // Shorter: it sees every store's customers.

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return s;
}

function sign(value) {
  return crypto.createHmac("sha256", secret()).update(value).digest("base64url");
}

/**
 * The cookie carries who you are, but signed — so a store person cannot edit it
 * in devtools to point at another store. Every read re-verifies.
 *
 * The role is part of the signed payload, not just the cookie name. That's what
 * stops a valid store cookie being pasted into the admin cookie slot to get
 * cross-store access: the signature covers "store", so it fails an admin check.
 */
export function createToken(role, subject, maxAgeSec) {
  const payload = `${role}:${subject}.${Date.now() + maxAgeSec * 1000}`;
  return `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`;
}

/** Returns the subject only if the signature, role and expiry all check out. */
export function verifyToken(token, expectedRole) {
  if (!token || typeof token !== "string") return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;

  let payload;
  try {
    payload = Buffer.from(body, "base64url").toString();
  } catch {
    return null;
  }

  const expected = sign(payload);
  // Constant-time compare so the signature can't be guessed byte by byte.
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const dot = payload.lastIndexOf(".");
  if (dot === -1) return null;
  const expires = Number(payload.slice(dot + 1));
  if (!expires || Date.now() > expires) return null;

  const colon = payload.indexOf(":");
  if (colon === -1) return null;
  const role = payload.slice(0, colon);
  const subject = payload.slice(colon + 1, dot);
  if (!subject || role !== expectedRole) return null;

  return subject;
}

function cookieOptions(maxAge) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge,
    path: "/",
  };
}

export function setSession(storeId) {
  cookies().set(
    STORE_COOKIE,
    createToken("store", storeId, STORE_MAX_AGE),
    cookieOptions(STORE_MAX_AGE)
  );
}

export function clearSession() {
  cookies().set(STORE_COOKIE, "", { maxAge: 0, path: "/" });
}

/** The only way any route learns which store is asking. */
export function currentStoreId() {
  return verifyToken(cookies().get(STORE_COOKIE)?.value, "store");
}

export function setAdminSession() {
  cookies().set(
    ADMIN_COOKIE,
    createToken("admin", "hq", ADMIN_MAX_AGE),
    cookieOptions(ADMIN_MAX_AGE)
  );
}

export function clearAdminSession() {
  cookies().set(ADMIN_COOKIE, "", { maxAge: 0, path: "/" });
}

/** The only way any route learns that head office is asking. */
export function isAdmin() {
  return verifyToken(cookies().get(ADMIN_COOKIE)?.value, "admin") === "hq";
}

/**
 * Admin is off unless ADMIN_CODE is set. It has to be opt-in: a default or
 * blank code would expose every store's customer list on a public URL.
 */
export function adminConfigured() {
  return Boolean(process.env.ADMIN_CODE && process.env.ADMIN_CODE.length >= 4);
}

/** Compared over fixed-width digests so the code's length doesn't leak. */
export function checkAdminCode(code) {
  if (!adminConfigured()) return false;
  const given = crypto.createHash("sha256").update(String(code ?? "")).digest();
  const real = crypto.createHash("sha256").update(process.env.ADMIN_CODE).digest();
  return crypto.timingSafeEqual(given, real);
}
