import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { route } from './envelope';
import { Forbidden } from './errors';

const req = () => new Request('http://localhost/api/test', { method: 'POST' });

describe('route() error mapping', () => {
  it('maps ApiException to its status + code', async () => {
    const h = route(async () => { throw new Forbidden('nope'); });
    const res = await h(req(), { params: {} });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: { code: 'FORBIDDEN', message: 'nope', requestId: undefined } });
  });
  it('maps a ZodError to 400 VALIDATION', async () => {
    const h = route(async () => { z.object({ a: z.string() }).parse({}); return new Response(); });
    const res = await h(req(), { params: {} });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION');
  });
  it('maps unknown errors to 500 INTERNAL without leaking the message', async () => {
    const h = route(async () => { throw new Error('db secret leaked'); });
    const res = await h(req(), { params: {} });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('INTERNAL');
    expect(body.error.message).not.toContain('db secret');
  });
});
