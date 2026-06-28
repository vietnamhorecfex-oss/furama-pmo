/**
 * S-03 — Common zod schemas reused across DTOs.
 * Rules from docs/03 §5 and docs/04 §6. All DTO schemas should `.strict()` to reject unknown fields.
 */
import { z } from 'zod';

/** cuid()-style id; permissive but bounded (Prisma uses cuid). */
export const idSchema = z.string().min(1).max(64);

/** Money: VND integer, no decimals, >= 0. Stored as BigInt server-side. */
export const moneyVndSchema = z
  .number()
  .int('Money must be an integer (VND has no decimals)')
  .nonnegative('Money must be >= 0');

/** Percent: integer 0–100. */
export const percentSchema = z.number().int().min(0).max(100);

/** ISO-8601 date string. */
export const isoDateSchema = z
  .string()
  .datetime({ offset: true })
  .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected ISO-8601 date'));

/** Pagination + sorting query (docs/04 §6). */
export const paginationQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    sort: z.string().max(64).optional(),
    order: z.enum(['asc', 'desc']).default('asc'),
  })
  .strict();
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** Bounded free-text helpers (docs/03 §5). */
export const titleSchema = z.string().trim().min(1).max(200);
export const descriptionSchema = z.string().max(4000).optional();
export const notesSchema = z.string().max(4000).optional();
export const commentBodySchema = z.string().trim().min(1).max(4000);

/** Email + strong-ish password (docs/03 §5). Common-password check is enforced in service. */
export const emailSchema = z.string().trim().toLowerCase().email().max(254);
export const passwordSchema = z.string().min(10).max(200);
