import { hash, verify } from "@node-rs/argon2";
import { z } from "zod";

/**
 * Argon2id, not bcrypt.
 *
 * bcrypt silently truncates at 72 bytes and is cheap to attack on GPUs.
 * Argon2id is memory-hard, which is what actually costs an attacker with
 * commodity hardware. These parameters follow the OWASP baseline.
 */
const OPTIONS = {
  memoryCost: 19_456, // 19 MiB
  timeCost: 2,
  outputLen: 32,
  parallelism: 1,
} as const;

export function hashPassword(plain: string): Promise<string> {
  return hash(plain, OPTIONS);
}

export async function verifyPassword(
  hashed: string,
  plain: string,
): Promise<boolean> {
  try {
    return await verify(hashed, plain, OPTIONS);
  } catch {
    // A malformed stored hash must read as "wrong password", never as a crash
    // that leaks which accounts have unusual records.
    return false;
  }
}

/**
 * Password policy.
 *
 * Length is the requirement that actually matters. Composition rules
 * (one symbol, one digit) push people toward "Password1!" and measurably
 * reduce entropy, so they are deliberately absent.
 */
export const passwordSchema = z
  .string()
  .min(10, "Use at least 10 characters.")
  .max(200, "That is longer than 200 characters.")
  .refine((v) => v.trim().length > 0, "Password cannot be only whitespace.");

export const emailSchema = z
  .email("Enter a valid email address.")
  .max(254)
  .transform((v) => v.trim().toLowerCase());

export const registerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter your name.")
    .max(80, "That name is too long."),
  email: emailSchema,
  password: passwordSchema,
});

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password."),
});

export type RegisterInput = z.infer<typeof registerSchema>;
