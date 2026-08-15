import crypto from "crypto";
import { cookies } from "next/headers";

const COOKIE = "frido_store";
const MAX_AGE = 60 * 60 * 12; // 12h — one working day, then they log in again.

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s) throw new Error("SESSION_SECRET is not set");
  return s;
}

function sign(value) {
  return crypto.createHmac("sha256", secret()).update(value).digest("base64url");
}

/**
 * The cookie carries the store id, but signed — so a store person cannot edit
 * it in devtools to point at another store. Every read re-verifies.
 */
export function createToken(storeId) {
  const payload = `${storeId}.${Date.now() + MAX_AGE * 1000}`;
  return `${Buffer.from(payload).toString("base64url")}.${sign(payload)}`;
}

export function verifyToken(token) {
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

  const idx = payload.lastIndexOf(".");
  const storeId = payload.slice(0, idx);
  const expires = Number(payload.slice(idx + 1));
  if (!storeId || !expires || Date.now() > expires) return null;

  return storeId;
}

export function setSession(storeId) {
  cookies().set(COOKIE, createToken(storeId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: MAX_AGE,
    path: "/",
  });
}

export function clearSession() {
  cookies().set(COOKIE, "", { maxAge: 0, path: "/" });
}

/** The only way any route learns which store is asking. */
export function currentStoreId() {
  return verifyToken(cookies().get(COOKIE)?.value);
}
