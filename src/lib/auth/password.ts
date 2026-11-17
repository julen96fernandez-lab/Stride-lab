import "server-only";
import { scrypt, timingSafeEqual } from "node:crypto";

/** Formato: scrypt:N:salt:hash (base64url). Ver scripts/hash-password.mjs */
export async function verifyPassword(password: string, stored: string | undefined): Promise<boolean> {
  if (!stored) return false;
  const [algo, nStr, saltB64, hashB64] = stored.split(":");
  if (algo !== "scrypt" || !nStr || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64url");
  const salt = Buffer.from(saltB64, "base64url");
  const N = Number(nStr);
  if (!Number.isInteger(N) || N < 1024 || expected.length < 16) return false;
  const derived = await new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, expected.length, { N, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}
