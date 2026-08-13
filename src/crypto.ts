import crypto from "node:crypto";
import { config } from "./config.js";

/* ------------------------------------------------------------ at rest */

function key(): Buffer {
  if (!config.masterKey) throw new Error("MASTER_KEY is not set. Run: npm run init");
  const buf = Buffer.from(config.masterKey, "hex");
  if (buf.length !== 32) throw new Error("MASTER_KEY must be 64 hex characters (32 bytes).");
  return buf;
}

/**
 * AES-256-GCM. Output: v1.<iv>.<tag>.<ciphertext>, all base64url.
 * The version prefix means the format can change later without a migration guess.
 */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), body.toString("base64url")].join(".");
}

export function decrypt(blob: string): string {
  if (!blob) return "";
  const [version, iv, tag, body] = blob.split(".");
  if (version !== "v1") throw new Error(`Unknown ciphertext version: ${version}`);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8");
}

/**
 * Deterministic HMAC of a lowercased term, so encrypted entries stay findable
 * by exact keyword without storing the text. Same word always maps to the same
 * token, which does leak word frequency. This is acceptable for a single-user tool,
 * not for shared multi-tenant data.
 */
export function blindToken(term: string): string {
  return crypto
    .createHmac("sha256", key())
    .update(term.toLowerCase().normalize("NFKD"))
    .digest("base64url")
    .slice(0, 22);
}

export function tokenize(text: string): string[] {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && w.length < 40);
  return [...new Set(words)].map(blindToken);
}

/* ---------------------------------------------------------- passwords */

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, salt, expected] = stored.split("$");
    if (scheme !== "scrypt") return false;
    const derived = crypto.scryptSync(password, Buffer.from(salt, "base64url"), 64, {
      N: 16384,
      r: 8,
      p: 1,
    });
    return crypto.timingSafeEqual(derived, Buffer.from(expected, "base64url"));
  } catch {
    return false;
  }
}

/* ----------------------------------------------------------- sessions */

export function signSession(expiresAt: number): string {
  const payload = String(expiresAt);
  const mac = crypto.createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");
  return `${payload}.${mac}`;
}

export function verifySession(token: string): boolean {
  if (!token || !config.sessionSecret) return false;
  const [payload, mac] = token.split(".");
  if (!payload || !mac) return false;
  const expected = crypto.createHmac("sha256", config.sessionSecret).update(payload).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  return Number(payload) > Date.now();
}

export function randomHex(bytes = 32): string {
  return crypto.randomBytes(bytes).toString("hex");
}
