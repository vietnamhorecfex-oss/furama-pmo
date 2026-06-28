/**
 * P-01 — Project DTOs (zod). docs/03 §M-PROJECT, docs/04 §2.
 * Money in VND is BigInt server-side; the wire format is a JSON number (safe within VND
 * because integer VND ≤ Number.MAX_SAFE_INTEGER for any plausible project budget).
 */
import { z } from 'zod';
import { isoDateSchema, moneyVndSchema, titleSchema } from './common';

export const projectStatusSchema = z.enum(['PLANNING', 'ACTIVE', 'OPENING', 'CLOSED', 'ARCHIVED']);

export const createProjectSchema = z
  .object({
    name: titleSchema,
    location: z.string().max(200).optional(),
    status: projectStatusSchema.default('PLANNING'),
    startDate: isoDateSchema.optional(),
    endDate: isoDateSchema.optional(),
    openingDate: isoDateSchema.optional(),
    budgetCapVnd: moneyVndSchema.default(0),
  })
  .strict()
  .refine(
    (v) => !v.startDate || !v.endDate || new Date(v.startDate) <= new Date(v.endDate),
    { message: 'startDate must be on or before endDate', path: ['endDate'] },
  )
  .refine(
    (v) => !v.openingDate || !v.startDate || new Date(v.startDate) <= new Date(v.openingDate),
    { message: 'openingDate must be on or after startDate', path: ['openingDate'] },
  )
  .refine(
    (v) => !v.openingDate || !v.endDate || new Date(v.openingDate) <= new Date(v.endDate),
    { message: 'openingDate must be on or before endDate', path: ['openingDate'] },
  );
export type CreateProjectDto = z.infer<typeof createProjectSchema>;

export const updateProjectMetaSchema = z
  .object({
    name: titleSchema.optional(),
    location: z.string().max(200).optional(),
    status: projectStatusSchema.optional(),
    startDate: isoDateSchema.nullish(),
    endDate: isoDateSchema.nullish(),
    openingDate: isoDateSchema.nullish(),
    budgetCapVnd: moneyVndSchema.optional(),
  })
  .strict();
export type UpdateProjectMetaDto = z.infer<typeof updateProjectMetaSchema>;

export const projectDtoSchema = z.object({
  id: z.string(),
  orgId: z.string(),
  name: z.string(),
  location: z.string().nullable(),
  status: projectStatusSchema,
  startDate: z.string().datetime().nullable(),
  endDate: z.string().datetime().nullable(),
  openingDate: z.string().datetime().nullable(),
  budgetCapVnd: z.number().int().nonnegative(),
  archivedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});
export type ProjectDto = z.infer<typeof projectDtoSchema>;
