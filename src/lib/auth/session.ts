import { SignJWT, jwtVerify } from "jose";

export const SESSION_COOKIE = "sl_session";
export const SESSION_MAX_AGE_S = 90 * 24 * 60 * 60; // 90 días

function secretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET no está configurado (mínimo 32 caracteres)");
  }
  return new TextEncoder().encode(secret);
}

export async function createSessionToken(): Promise<string> {
  return new SignJWT({ sub: "owner" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_S}s`)
    .sign(secretKey());
}

export async function isValidSessionToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    return payload.sub === "owner";
  } catch {
    return false;
  }
}

export const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_MAX_AGE_S,
};
