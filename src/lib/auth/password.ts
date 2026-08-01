import bcrypt from "bcryptjs";

/**
 * bcryptjs (pure JS) rather than a native argon2 binding: serverless bundles must not carry
 * platform binaries, and at this app's scale bcrypt-12 is an entirely adequate wall. The
 * cost factor is the one security knob here — change it only knowingly.
 */
const COST = 12;

export function hashPassword(plain: string): string {
  return bcrypt.hashSync(plain, COST);
}

export function verifyPassword(plain: string, hash: string): boolean {
  return bcrypt.compareSync(plain, hash);
}
