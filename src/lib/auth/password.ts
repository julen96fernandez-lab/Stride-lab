import "server-only";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const N = 16384;
const KEY_LEN = 32;

function derive(password: string, salt: Buffer, n: number, len: number): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, len, { N: n, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

/** Devuelve `scrypt:N:salt:hash` (base64url). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await derive(password, salt, N, KEY_LEN);
  return ["scrypt", N, salt.toString("base64url"), hash.toString("base64url")].join(":");
}

export async function verifyPassword(password: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [algo, nStr, saltB64, hashB64] = stored.split(":");
  if (algo !== "scrypt" || !nStr || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64url");
  const n = Number(nStr);
  if (!Number.isInteger(n) || n < 1024 || expected.length < 16) return false;
  const derived = await derive(password, Buffer.from(saltB64, "base64url"), n, expected.length);
  return timingSafeEqual(derived, expected);
}

/** Comparación en tiempo constante de dos textos (p. ej. el código de configuración). */
export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export const MIN_PASSWORD_LENGTH = 10;
