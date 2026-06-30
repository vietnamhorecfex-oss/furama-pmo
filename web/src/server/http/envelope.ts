import { ZodError } from 'zod';
import type { ApiError } from '@furama/shared';
import { ApiException } from './errors';

type ErrorCode = ApiError['error']['code'];

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: 'VALIDATION', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN',
  404: 'NOT_FOUND', 409: 'CONFLICT', 429: 'RATE_LIMITED',
};

export function toErrorResponse(err: unknown, requestId?: string): Response {
  let status = 500;
  let message = 'An unexpected error occurred.';

  if (err instanceof ApiException) {
    status = err.status;
    message = err.message;
  } else if (err instanceof ZodError) {
    status = 400;
    message = err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
  } else {
    // Unknown/internal: log server-side, return generic message.
    console.error('Unhandled error', err);
  }

  const code: ErrorCode = STATUS_TO_CODE[status] ?? (status >= 500 ? 'INTERNAL' : 'VALIDATION');
  const payload: ApiError = { error: { code, message, requestId } };
  return Response.json(payload, { status });
}

type Handler = (req: Request, ctx: { params: Record<string, string> }) => Promise<Response>;

export function route(fn: Handler): Handler {
  return async (req, ctx) => {
    const requestId = req.headers.get('x-request-id') ?? undefined;
    try {
      return await fn(req, ctx);
    } catch (err) {
      return toErrorResponse(err, requestId);
    }
  };
}
