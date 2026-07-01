import { Conflict } from '../http/errors';

/** Translate Prisma's unique-violation P2002 into a friendly Conflict. */
export function uniqueClash(err: unknown, friendly: string): Error {
  const code = (err as { code?: string }).code;
  if (code === 'P2002') return new Conflict(friendly);
  return err as Error;
}
