/**
 * S-06 — Global exception filter producing the docs/04 §4 error envelope.
 * Maps known exceptions to stable codes; never leaks stack traces or Prisma/DB messages.
 */
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { ApiError } from '@furama/shared';

type ErrorCode = ApiError['error']['code'];

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
  [HttpStatus.CONFLICT]: 'CONFLICT',
  [HttpStatus.TOO_MANY_REQUESTS]: 'RATE_LIMITED',
};

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    const requestId = (req.id ?? req.headers['x-request-id']) as string | undefined;

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'An unexpected error occurred.';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      const raw: string | string[] =
        typeof body === 'string'
          ? body
          : ((body as { message?: string | string[] }).message ?? exception.message);
      message = Array.isArray(raw) ? raw.join('; ') : raw;
    } else {
      // Unknown/internal error: log server-side, return generic message to client.
      this.logger.error(
        `Unhandled exception on ${req.method} ${req.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const code: ErrorCode =
      STATUS_TO_CODE[status] ?? (status >= 500 ? 'INTERNAL' : 'VALIDATION');

    const payload: ApiError = { error: { code, message, requestId } };
    res.status(status).json(payload);
  }
}
