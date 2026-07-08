import { randomInt } from 'node:crypto';

// Ambiguous characters (0/O, 1/l/I) removed so the one-time password is easy to read aloud/copy.
const ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Cryptographically-random initial password. Length 14 comfortably exceeds the
 * 10-char minimum enforced by passwordSchema.
 */
export function generatePassword(length = 14): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
}
