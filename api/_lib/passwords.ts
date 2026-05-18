/**
 * Password hashing + validation.
 *
 * - bcryptjs (pure JS — works on Vercel without native build).
 * - Cost factor 10: ~70ms per hash on Vercel's serverless runtime, which
 *   keeps login latency tolerable while making offline cracking expensive.
 * - validateStrength enforces: ≥8 chars, ≥1 letter, ≥1 digit. We avoid
 *   special-char requirements that frustrate users; length is what matters.
 */
import bcrypt from "bcryptjs";

const COST = 10;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

export interface ValidationResult {
  ok: boolean;
  reason?: string;
}

export function validateStrength(plain: string): ValidationResult {
  if (typeof plain !== "string") return { ok: false, reason: "Password is required" };
  if (plain.length < 8)  return { ok: false, reason: "Password must be at least 8 characters" };
  if (plain.length > 256) return { ok: false, reason: "Password is too long" };
  if (!/[A-Za-z]/.test(plain)) return { ok: false, reason: "Password must contain at least one letter" };
  if (!/\d/.test(plain))       return { ok: false, reason: "Password must contain at least one number" };
  return { ok: true };
}

/** Server-side response sanitizer — never let passwordHash leak to clients. */
export function publicUser<T extends { passwordHash?: string | null }>(u: T): Omit<T, "passwordHash"> {
  const { passwordHash, ...rest } = u;
  return rest;
}
