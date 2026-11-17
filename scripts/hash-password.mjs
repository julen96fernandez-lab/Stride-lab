// Genera AUTH_PASSWORD_HASH para una contraseña: npm run hash-password -- 'mi-contraseña'
import { randomBytes, scryptSync } from "node:crypto";

const password = process.argv[2];
if (!password || password.length < 10) {
  console.error("Uso: npm run hash-password -- '<contraseña de 10+ caracteres>'");
  process.exit(1);
}
const N = 16384;
const salt = randomBytes(16);
const hash = scryptSync(password, salt, 32, { N, r: 8, p: 1 });
console.log(["scrypt", N, salt.toString("base64url"), hash.toString("base64url")].join(":"));
