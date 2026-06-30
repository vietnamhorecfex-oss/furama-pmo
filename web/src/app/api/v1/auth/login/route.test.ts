import { describe, it, expect } from 'vitest';
import { POST } from './route';

describe('POST /api/v1/auth/login body parsing', () => {
  it('returns 400 (not 500) for an empty body', async () => {
    const req = new Request('http://localhost/api/v1/auth/login', { method: 'POST' });
    const res = await POST(req, { params: {} } as any);
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('VALIDATION');
  });
  it('returns 400 for malformed JSON', async () => {
    const req = new Request('http://localhost/api/v1/auth/login', { method: 'POST', body: '{not json' });
    const res = await POST(req, { params: {} } as any);
    expect(res.status).toBe(400);
  });
});
