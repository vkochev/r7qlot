import OpenAI from 'openai';
import type {
  ChatCompletion,
  ChatCompletionMessageParam,
  ChatCompletionMessageToolCall,
  ChatCompletionTool,
} from 'openai/resources/chat/completions';
import { McpManager } from './mcp.js';

type ToolPolicy = { allowlist?: string[]; denylist?: string[] };

export type AgentConfig = {
  max_steps: number;
  request_timeout_ms: number;
  max_tool_output_bytes: number;
  tool_policy?: ToolPolicy;
  status_tags_enabled?: boolean;
  repeat_tool_call_limit?: number;
};

export type UpstreamConfig = { base_url: string; model: string; api_key: string; timeout_ms?: number };

export type AgentRunInput = {
  messages: ChatCompletionMessageParam[];
  agent: AgentConfig;
  upstream: UpstreamConfig;
  mcp: McpManager;
  signal?: AbortSignal;
  onChunk?: (txt: string) => void;
};

const statusTag = (enabled: boolean, msg: string) => (enabled ? `[STATUS]${msg}[/STATUS]` : msg);

function createOperationSignal(parent: AbortSignal | undefined, timeoutMs: number): AbortSignal {
  if (parent) {
    return AbortSignal.any([parent, AbortSignal.timeout(timeoutMs)]);
  }
  return AbortSignal.timeout(timeoutMs);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function remainingMs(deadlineAt: number): number {
  return Math.max(0, deadlineAt - Date.now());
}

export async function runAgent(input: AgentRunInput): Promise<string> {
  const emit = (t: string) => input.onChunk?.(t);
  const deadlineAt = Date.now() + input.agent.request_timeout_ms;
  const repeatLimit = Math.max(1, input.agent.repeat_tool_call_limit ?? 3);
  const repeatGuard = new Map<string, number>();
  const timeoutCheck = () => {
    if (input.signal?.aborted) throw new Error('request aborted by client');
    if (Date.now() > deadlineAt) throw new Error('request deadline exceeded');
  };

  timeoutCheck();
  emit(statusTag(!!input.agent.status_tags_enabled, 'Планирую шаги'));
  emit(statusTag(!!input.agent.status_tags_enabled, 'Получаю список инструментов'));

  const tools = (await input.mcp.listTools({ signal: createOperationSignal(input.signal, remainingMs(deadlineAt)) })).filter((t) => {
    const allow = input.agent.tool_policy?.allowlist;
    const deny = input.agent.tool_policy?.denylist;
    if (allow && allow.length && !allow.includes(t.name)) return false;
    if (deny && deny.includes(t.name)) return false;
    return true;
  });

  const messages: ChatCompletionMessageParam[] = [...input.messages];
  const upstream = new OpenAI({ apiKey: input.upstream.api_key, baseURL: input.upstream.base_url });
  const upstreamTools: ChatCompletionTool[] = tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: (t.inputSchema ?? { type: 'object', additionalProperties: true }) as Record<string, unknown>,
    },
  }));

  for (let step = 0; step < input.agent.max_steps; step++) {
    timeoutCheck();
    emit(statusTag(!!input.agent.status_tags_enabled, `Шаг ${step + 1}/${input.agent.max_steps}`));

    const response = (await upstream.chat.completions.create(
      {
        model: input.upstream.model,
        stream: false,
        messages,
        tools: upstreamTools.length ? upstreamTools : undefined,
      },
      {
        signal: createOperationSignal(
          input.signal,
          Math.min(input.upstream.timeout_ms ?? input.agent.request_timeout_ms, remainingMs(deadlineAt)),
        ),
      },
    )) as ChatCompletion;

    const msg = response.choices?.[0]?.message;
    if (!msg) throw new Error('upstream returned empty choice');

    const toolCalls = msg.tool_calls as ChatCompletionMessageToolCall[] | undefined;
    if (toolCalls?.length) {
      messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: toolCalls });
      for (const call of toolCalls) {
        timeoutCheck();
        const name = call.function.name;
        const toolMeta = tools.find((t) => t.name === name);
        if (!toolMeta) throw new Error(`tool not allowed or unavailable: ${name}`);

        const args: unknown = JSON.parse(call.function.arguments || '{}');
        const guardKey = `${name}:${stableStringify(args)}`;
        const nextCount = (repeatGuard.get(guardKey) ?? 0) + 1;
        repeatGuard.set(guardKey, nextCount);
        if (nextCount > repeatLimit) {
          throw new Error(`repeated tool-call guard triggered for ${name} (${nextCount} > ${repeatLimit})`);
        }

        emit(statusTag(!!input.agent.status_tags_enabled, `Вызываю tool: ${name}`));
        const raw = await input.mcp.callTool(toolMeta._serverName, name, args, {
          signal: createOperationSignal(input.signal, remainingMs(deadlineAt)),
        });

        let text = typeof raw === 'string' ? raw : JSON.stringify(raw);
        const bytes = Buffer.byteLength(text, 'utf8');
        if (bytes > input.agent.max_tool_output_bytes) {
          const trimmed = Buffer.from(text, 'utf8').subarray(0, input.agent.max_tool_output_bytes).toString('utf8');
          const droppedBytes = bytes - input.agent.max_tool_output_bytes;
          text = `${trimmed}\n...[truncated ${droppedBytes} bytes; original=${bytes} bytes, limit=${input.agent.max_tool_output_bytes}]`;
        }
        messages.push({ role: 'tool', tool_call_id: call.id, content: text });
      }
      continue;
    }

    emit(statusTag(!!input.agent.status_tags_enabled, 'Формирую финальный ответ'));
    const finalText = msg.content ?? '';
    emit(finalText);
    return finalText;
  }

  throw new Error(`max steps exceeded: ${input.agent.max_steps}`);
}
