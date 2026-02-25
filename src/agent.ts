import OpenAI from 'openai';
import { McpManager } from './mcp.js';

type ChatMessage = { role: string; content?: string; tool_calls?: any[]; tool_call_id?: string; name?: string };

export type AgentConfig = {
  max_steps: number;
  request_timeout_ms: number;
  max_tool_output_bytes: number;
  tool_policy?: { allowlist?: string[]; denylist?: string[] };
  status_tags_enabled?: boolean;
};

export type UpstreamConfig = { base_url: string; model: string; api_key: string; timeout_ms?: number };

export type AgentRunInput = {
  messages: ChatMessage[];
  agent: AgentConfig;
  upstream: UpstreamConfig;
  mcp: McpManager;
  onChunk?: (txt: string) => void;
};

const statusTag = (enabled: boolean, msg: string) => (enabled ? `[STATUS]${msg}[/STATUS]` : msg);

export async function runAgent(input: AgentRunInput): Promise<string> {
  const started = Date.now();
  const emit = (t: string) => input.onChunk?.(t);
  const timeoutCheck = () => {
    if (Date.now() - started > input.agent.request_timeout_ms) throw new Error('request timeout exceeded');
  };

  timeoutCheck();
  emit(statusTag(!!input.agent.status_tags_enabled, 'Планирую шаги'));
  emit(statusTag(!!input.agent.status_tags_enabled, 'Получаю список инструментов'));

  const tools = (await input.mcp.listTools()).filter((t) => {
    const allow = input.agent.tool_policy?.allowlist;
    const deny = input.agent.tool_policy?.denylist;
    if (allow && allow.length && !allow.includes(t.name)) return false;
    if (deny && deny.includes(t.name)) return false;
    return true;
  });

  const messages: ChatMessage[] = [...input.messages];
  const upstream = new OpenAI({ apiKey: input.upstream.api_key, baseURL: input.upstream.base_url });

  for (let step = 0; step < input.agent.max_steps; step++) {
    timeoutCheck();
    const json: any = await upstream.chat.completions.create(
      {
        model: input.upstream.model,
        stream: false,
        messages: messages as any,
        tools: tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema as any } })) as any,
      } as any,
      { signal: AbortSignal.timeout(input.upstream.timeout_ms ?? input.agent.request_timeout_ms) },
    );

    const msg = json.choices?.[0]?.message;
    if (!msg) throw new Error('upstream returned empty choice');

    if (msg.tool_calls?.length) {
      messages.push({ role: 'assistant', content: msg.content ?? '', tool_calls: msg.tool_calls });
      for (const call of msg.tool_calls) {
        const name: string = call.function.name;
        const toolMeta = tools.find((t) => t.name === name);
        if (!toolMeta) throw new Error(`tool not allowed or unavailable: ${name}`);
        emit(statusTag(!!input.agent.status_tags_enabled, `Вызываю tool: ${name}`));
        const args = JSON.parse(call.function.arguments || '{}');
        const raw = await input.mcp.callTool(toolMeta._serverName, name, args);
        let text = typeof raw === 'string' ? raw : JSON.stringify(raw);
        const bytes = Buffer.byteLength(text, 'utf8');
        if (bytes > input.agent.max_tool_output_bytes) {
          text = Buffer.from(text, 'utf8').subarray(0, input.agent.max_tool_output_bytes).toString('utf8');
          text += '\n...[truncated]';
        }
        messages.push({ role: 'tool', tool_call_id: call.id, name, content: text });
      }
      continue;
    }

    emit(statusTag(!!input.agent.status_tags_enabled, 'Формирую финальный ответ'));
    const finalText = msg.content ?? '';
    const tokens = finalText.split(/(\s+)/).filter(Boolean);
    for (const tk of tokens) emit(tk);
    return finalText;
  }

  throw new Error('max steps exceeded');
}
