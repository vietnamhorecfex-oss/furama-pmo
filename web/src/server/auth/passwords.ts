import * as argon2 from 'argon2';
import { getConfig } from '../config';

function opts(): argon2.Options & { type: 0 | 1 | 2 } {
  const c = getConfig();
  return {
    type: argon2.argon2id,
    memoryCost: c.ARGON2_MEMORY_KIB,
    timeCost: c.ARGON2_TIME_COST,
    parallelism: c.ARGON2_PARALLELISM,
  };
}

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, opts());
}
export function verifyPassword(hash: string, plain: string): Promise<boolean> {
  return argon2.verify(hash, plain);
}
export function needsRehash(hash: string): boolean {
  return argon2.needsRehash(hash, opts());
}
