/**
 * Unit tests for the Gemini adapter (no network — fetch is injected).
 * Covers request conversion (system, tool round-trip, schema sanitizing),
 * response conversion (text / functionCall → stop_reason), and HTTP errors.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { createGeminiClient, toGeminiRequest, sanitizeSchema, toAnthropicMessage } from './gemini';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const BASE_PARAMS: Anthropic.MessageCreateParamsNonStreaming = {
  model: 'claude-haiku-4-5-20251001', // ignored by the adapter
  max_tokens: 512,
  system: 'You are a helper.',
  messages: [{ role: 'user', content: 'hello' }],
};

describe('toGeminiRequest', () => {
  it('maps system, roles, and max_tokens', () => {
    const req = toGeminiRequest(BASE_PARAMS);
    expect(req.systemInstruction?.parts[0]?.text).toBe('You are a helper.');
    expect(req.contents).toEqual([{ role: 'user', parts: [{ text: 'hello' }] }]);
    expect(req.generationConfig?.maxOutputTokens).toBe(512);
  });

  it('disables thinking by default so max_tokens is spent on visible text', () => {
    const req = toGeminiRequest(BASE_PARAMS);
    expect(req.generationConfig?.thinkingConfig).toEqual({ thinkingBudget: 0 });
  });

  describe('GEMINI_THINKING_BUDGET override', () => {
    afterEach(() => vi.unstubAllEnvs());

    it('uses the env value when set', () => {
      vi.stubEnv('GEMINI_THINKING_BUDGET', '2048');
      const req = toGeminiRequest(BASE_PARAMS);
      expect(req.generationConfig?.thinkingConfig).toEqual({ thinkingBudget: 2048 });
    });

    it('omits thinkingConfig for non-numeric values (model default applies)', () => {
      vi.stubEnv('GEMINI_THINKING_BUDGET', 'auto');
      const req = toGeminiRequest(BASE_PARAMS);
      expect(req.generationConfig?.thinkingConfig).toBeUndefined();
    });
  });

  it('round-trips tool_use → functionCall and tool_result → functionResponse (name via id)', () => {
    const req = toGeminiRequest({
      ...BASE_PARAMS,
      messages: [
        { role: 'user', content: 'find tasks' },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Checking…' },
            { type: 'tool_use', id: 'tu_1', name: 'search_tasks', input: { q: 'PBX' } },
          ],
        },
        {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tu_1', content: '{"total":1}' }],
        },
      ],
    });
    expect(req.contents[1]).toEqual({
      role: 'model',
      parts: [{ text: 'Checking…' }, { functionCall: { name: 'search_tasks', args: { q: 'PBX' } } }],
    });
    expect(req.contents[2]).toEqual({
      role: 'user',
      parts: [{ functionResponse: { name: 'search_tasks', response: { result: '{"total":1}' } } }],
    });
  });

  it('declares tools with sanitized schemas and omits parameters for no-arg tools', () => {
    const req = toGeminiRequest({
      ...BASE_PARAMS,
      tools: [
        {
          name: 'whoami',
          description: 'who am i',
          input_schema: { type: 'object', properties: {}, additionalProperties: false },
        },
        {
          name: 'search_tasks',
          description: 'search',
          input_schema: {
            type: 'object',
            properties: {
              q: { type: 'string', description: 'query' },
              page: { type: 'integer', minimum: 1, default: 1 },
              due: { type: 'string', format: 'date', maxLength: 10 },
            },
            required: ['q'],
            additionalProperties: false,
          },
        },
      ] as Anthropic.Tool[],
    });
    const decls = req.tools?.[0]?.functionDeclarations ?? [];
    expect(decls[0]).toEqual({ name: 'whoami', description: 'who am i' }); // no parameters
    const params = decls[1]?.parameters as {
      type: string;
      required: string[];
      properties: Record<string, Record<string, unknown>>;
    };
    expect(params.type).toBe('object');
    expect(params.required).toEqual(['q']);
    const props = params.properties;
    expect(props.q).toEqual({ type: 'string', description: 'query' });
    expect(props.page).toEqual({ type: 'integer' }); // minimum/default stripped
    expect(props.due).toEqual({ type: 'string' }); // format/maxLength stripped
    expect(JSON.stringify(params)).not.toContain('additionalProperties');
  });
});

describe('sanitizeSchema', () => {
  it('returns undefined for empty object schemas', () => {
    expect(sanitizeSchema({ type: 'object', properties: {}, additionalProperties: false })).toBeUndefined();
  });
});

describe('toAnthropicMessage', () => {
  it('maps text parts to end_turn', () => {
    const msg = toAnthropicMessage(
      { candidates: [{ content: { parts: [{ text: 'Xin chào' }] } }] },
      'gemini-2.5-flash',
    );
    expect(msg.stop_reason).toBe('end_turn');
    expect(msg.content[0]).toMatchObject({ type: 'text', text: 'Xin chào' });
  });

  it('maps functionCall parts to tool_use + stop_reason tool_use', () => {
    const msg = toAnthropicMessage(
      {
        candidates: [
          { content: { parts: [{ functionCall: { name: 'list_overdue', args: { workstreamId: 'w1' } } }] } },
        ],
      },
      'gemini-2.5-flash',
    );
    expect(msg.stop_reason).toBe('tool_use');
    expect(msg.content[0]).toMatchObject({ type: 'tool_use', name: 'list_overdue', input: { workstreamId: 'w1' } });
    expect((msg.content[0] as { id: string }).id).toMatch(/^toolu_gm_/);
  });
});

describe('createGeminiClient', () => {
  it('POSTs to generateContent with the api key header and converts the response', async () => {
    let captured: { url: string; init: RequestInit } | null = null;
    const client = createGeminiClient({
      apiKey: 'test-key',
      model: 'gemini-2.5-flash',
      fetchFn: async (url, init) => {
        captured = { url, init };
        return jsonResponse({ candidates: [{ content: { parts: [{ text: 'ok' }] } }] });
      },
    });
    const msg = await client.messages.create(BASE_PARAMS);
    expect(captured!.url).toContain('/models/gemini-2.5-flash:generateContent');
    expect((captured!.init.headers as Record<string, string>)['x-goog-api-key']).toBe('test-key');
    const sent = JSON.parse(String(captured!.init.body));
    expect(sent.contents).toHaveLength(1);
    expect(msg.stop_reason).toBe('end_turn');
  });

  it('throws a descriptive error on non-OK responses', async () => {
    const client = createGeminiClient({
      apiKey: 'bad',
      model: 'gemini-2.5-flash',
      fetchFn: async () => jsonResponse({ error: { message: 'API key not valid' } }, 400),
    });
    await expect(client.messages.create(BASE_PARAMS)).rejects.toThrow(/Gemini API error 400/);
  });
});
