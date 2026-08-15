import crypto from "crypto";
import { cookies } from "next/headers";

const STORE_COOKIE = "frido_store";
const ADMIN_COOKIE = "frido_admin";

const MAX_AGE = 60 * 60 * 12; // 12h — one working day, then they log in again.
const ADMIN_MAX_AGE = 60 * 60 * 8; // admin sees every store; expire it sooner.

const STORE_ROLE = "store";
const ADMIN_ROLE = "admin";

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
 * The role lives *inside* the signed payload, which is what stops a store
 * cookie being replayed as an admin one: an attacker holding a valid store
 * token cannot re-sign it as `admin:` without SESSION_SECRET, and verification
 * refuses any token whose embedded role isn't the one being asked for.
 */
export function createToken(subject, role = STORE_ROLE) {
  const payload = `${role}:${subject}.${Date.now() + ageFor(role) * 1000}`;
  return `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`;
}

function ageFor(role) {
  return role === ADMIN_ROLE ? ADMIN_MAX_AGE : MAX_AGE;
}

export function verifyToken(token, expectedRole = STORE_ROLE) {
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

  // Split on the FIRST colon only — a store id may legitimately contain one.
  const colon = payload.indexOf(":");
  if (colon === -1) return null;
  const role = payload.slice(0, colon);
  if (role !== expectedRole) return null;

  const rest = payload.slice(colon + 1);
  const idx = rest.lastIndexOf(".");
  if (idx === -1) return null;
  const subject = rest.slice(0, idx);
  const expires = Number(rest.slice(idx + 1));
  if (!subject || !expires || Date.now() > expires) return null;

  return subject;
}

function cookieOpts(maxAge) {
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
    createToken(storeId, STORE_ROLE),
    cookieOpts(MAX_AGE)
  );
}

export function clearSession() {
  cookies().set(STORE_COOKIE, "", { maxAge: 0, path: "/" });
}

/** The only way any route learns which store is asking. */
export function currentStoreId() {
  return verifyToken(cookies().get(STORE_COOKIE)?.value, STORE_ROLE);
}

// --- admin -------------------------------------------------------------------

export function setAdminSession() {
  cookies().set(
    ADMIN_COOKIE,
    createToken("hq", ADMIN_ROLE),
    cookieOpts(ADMIN_MAX_AGE)
  );
}

export function clearAdminSession() {
  cookies().set(ADMIN_COOKIE, "", { maxAge: 0, path: "/" });
}

/**
 * True only for a validly signed admin token. Every cross-store read is gated
 * on this — see getAdminOverview() in lib/data.js.
 */
export function isAdmin() {
  return verifyToken(cookies().get(ADMIN_COOKIE)?.value, ADMIN_ROLE) === "hq";
}
