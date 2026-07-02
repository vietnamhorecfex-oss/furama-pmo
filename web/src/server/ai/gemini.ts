/**
 * Gemini adapter — implements the AnthropicLike seam over Google's Gemini REST API
 * (models/*:generateContent), so assistant.ts and digest.ts run unchanged on a
 * GEMINI_API_KEY. The adapter:
 *
 *  - converts Anthropic-shaped params (system / messages / tools / max_tokens) to
 *    Gemini contents / systemInstruction / functionDeclarations / generationConfig;
 *  - maps tool calls both ways: Anthropic `tool_use` ⇄ Gemini `functionCall`, and
 *    Anthropic `tool_result` → Gemini `functionResponse` (function name recovered
 *    from the tool_use id seen earlier in the same message array);
 *  - returns an Anthropic-shaped Message with stop_reason 'tool_use' | 'end_turn'.
 *
 * The Anthropic model id passed by callers (AI_MODEL_REASONING) is IGNORED here —
 * the Gemini model comes from GEMINI_MODEL (default gemini-2.5-flash). fetch is
 * injectable for offline tests.
 */
import type Anthropic from '@anthropic-ai/sdk';
import type { AnthropicLike } from './assistant';

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

interface GeminiPart {
  text?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiRequest {
  contents: GeminiContent[];
  systemInstruction?: { parts: { text: string }[] };
  tools?: { functionDeclarations: { name: string; description?: string; parameters?: unknown }[] }[];
  generationConfig?: { maxOutputTokens?: number };
}

interface GeminiResponse {
  candidates?: { content?: { parts?: GeminiPart[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
}

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

export function getGeminiClient(deps?: { fetchFn?: FetchLike }): AnthropicLike | null {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const model = process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL;
  return createGeminiClient({ apiKey: key, model, fetchFn: deps?.fetchFn });
}

export function createGeminiClient(opts: {
  apiKey: string;
  model: string;
  fetchFn?: FetchLike;
}): AnthropicLike {
  const doFetch: FetchLike = opts.fetchFn ?? ((url, init) => fetch(url, init));

  return {
    messages: {
      async create(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> {
        const body = toGeminiRequest(params);
        const res = await doFetch(`${BASE_URL}/${opts.model}:generateContent`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': opts.apiKey },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(60_000),
        });
        if (!res.ok) {
          const detail = (await res.text().catch(() => '')).slice(0, 500);
          throw new Error(`Gemini API error ${res.status}: ${detail}`);
        }
        const json = (await res.json()) as GeminiResponse;
        return toAnthropicMessage(json, opts.model);
      },
    },
  };
}

// ─── request conversion ─────────────────────────────────────────────────────────

export function toGeminiRequest(params: Anthropic.MessageCreateParamsNonStreaming): GeminiRequest {
  const req: GeminiRequest = { contents: [] };

  if (typeof params.system === 'string' && params.system.trim()) {
    req.systemInstruction = { parts: [{ text: params.system }] };
  }

  // tool_use id → tool name, learned from assistant messages earlier in the array.
  const toolNameById = new Map<string, string>();

  for (const m of params.messages) {
    const role: 'user' | 'model' = m.role === 'assistant' ? 'model' : 'user';
    const parts: GeminiPart[] = [];

    if (typeof m.content === 'string') {
      if (m.content) parts.push({ text: m.content });
    } else {
      for (const block of m.content) {
        if (block.type === 'text') {
          parts.push({ text: block.text });
        } else if (block.type === 'tool_use') {
          toolNameById.set(block.id, block.name);
          parts.push({
            functionCall: { name: block.name, args: (block.input ?? {}) as Record<string, unknown> },
          });
        } else if (block.type === 'tool_result') {
          const name = toolNameById.get(block.tool_use_id) ?? 'unknown_tool';
          parts.push({ functionResponse: { name, response: { result: toolResultText(block) } } });
        }
        // other block types (image, thinking, …) are not used by this app — skipped.
      }
    }

    if (parts.length) req.contents.push({ role, parts });
  }

  const decls = (params.tools ?? [])
    .filter((t): t is Anthropic.Tool => 'input_schema' in t)
    .map((t) => {
      const parameters = sanitizeSchema(t.input_schema);
      return {
        name: t.name,
        description: t.description,
        ...(parameters ? { parameters } : {}),
      };
    });
  if (decls.length) req.tools = [{ functionDeclarations: decls }];

  if (params.max_tokens) req.generationConfig = { maxOutputTokens: params.max_tokens };

  return req;
}

function toolResultText(block: Anthropic.ToolResultBlockParam): string {
  const c = block.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .map((p) => (p.type === 'text' ? p.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

/**
 * Gemini's functionDeclarations.parameters accepts an OpenAPI-3.0 schema SUBSET and
 * rejects unknown keywords. Keep a whitelist (type/description/enum/properties/
 * required/items/nullable); drop additionalProperties, default, format, maxLength,
 * minimum/maximum, $comment, … Returns undefined for empty object schemas (tools
 * with no args must omit `parameters` entirely).
 */
export function sanitizeSchema(schema: unknown): unknown {
  // No-arg tool (root object with no properties): omit `parameters` entirely.
  if (schema && typeof schema === 'object' && !Array.isArray(schema)) {
    const root = schema as Record<string, unknown>;
    const props = (root.properties as object | undefined) ?? {};
    if (root.type === 'object' && Object.keys(props).length === 0) return undefined;
  }
  return walkSchema(schema);
}

function walkSchema(node: unknown): unknown {
  if (node === null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(walkSchema);

  const src = node as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  if (typeof src.type === 'string') out.type = src.type;
  if (typeof src.description === 'string') out.description = src.description;
  if (Array.isArray(src.enum)) out.enum = src.enum;
  if (Array.isArray(src.required) && src.required.length) out.required = src.required;
  if (src.nullable !== undefined) out.nullable = src.nullable;
  if (src.items !== undefined) out.items = walkSchema(src.items);
  if (src.properties && typeof src.properties === 'object') {
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(src.properties as Record<string, unknown>)) {
      props[k] = walkSchema(v);
    }
    out.properties = props;
  }
  // Gemini rejects OBJECT schemas with empty/missing properties ("properties should
  // be non-empty for OBJECT type") — for such nodes drop the type and keep the
  // description, which the API treats as an unconstrained value.
  if (out.type === 'object' && Object.keys((out.properties as object | undefined) ?? {}).length === 0) {
    delete out.type;
    delete out.properties;
  }
  return out;
}

// ─── response conversion ────────────────────────────────────────────────────────

let toolUseSeq = 0;

export function toAnthropicMessage(res: GeminiResponse, model: string): Anthropic.Message {
  const parts = res.candidates?.[0]?.content?.parts ?? [];
  const content: unknown[] = [];
  let hasToolCall = false;

  for (const p of parts) {
    if (typeof p.text === 'string' && p.text) {
      content.push({ type: 'text', text: p.text, citations: null });
    } else if (p.functionCall) {
      hasToolCall = true;
      content.push({
        type: 'tool_use',
        id: `toolu_gm_${Date.now().toString(36)}_${toolUseSeq++}`,
        name: p.functionCall.name,
        input: p.functionCall.args ?? {},
      });
    }
  }

  const message = {
    id: `msg_gm_${Date.now().toString(36)}`,
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: hasToolCall ? 'tool_use' : 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: res.usageMetadata?.promptTokenCount ?? 0,
      output_tokens: res.usageMetadata?.candidatesTokenCount ?? 0,
    },
  };
  return message as unknown as Anthropic.Message;
}
