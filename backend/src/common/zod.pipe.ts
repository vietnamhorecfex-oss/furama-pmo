/**
 * Zod-based validation pipe. Schemas live in shared/ (single source of DTO truth).
 * Use as `@Body(new ZodPipe(loginSchema))` to validate + strip unknown fields (.strict() enforced by the schema).
 */
import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const message = result.error.issues
        .map((i) => `${i.path.join('.') || '(body)'}: ${i.message}`)
        .join('; ');
      throw new BadRequestException(message);
    }
    return result.data;
  }
}
