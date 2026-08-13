import { config } from "./config.js";

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_name?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  function: { name: string; arguments: Record<string, any> };
}

export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: { type: "object"; properties: Record<string, any>; required?: string[] };
  };
}

interface ChatOptions {
  model?: string;
  signal?: AbortSignal;
}

interface OllamaStatus {
  state: "unknown" | "online" | "offline" | "degraded";
  model: string;
  lastCheckedAt: string | null;
  lastSuccessAt: string | null;
  latencyMs: number | null;
  error: string;
}

const status: OllamaStatus = {
  state: "unknown", model: config.model, lastCheckedAt: null, lastSuccessAt: null, latencyMs: null, error: "",
};

export function getOllamaStatus(): OllamaStatus {
  return { ...status };
}

function headers(): Record<string, string> {
  const result: Record<string, string> = { "Content-Type": "application/json" };
  if (config.ollamaApiKey) result.Authorization = `Bearer ${config.ollamaApiKey}`;
  return result;
}

function timedSignal(timeoutMs: number, external?: AbortSignal): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("Ollama request timed out.")), timeoutMs);
  const cancel = () => controller.abort(external?.reason || new Error("Ollama request cancelled."));
  if (external) external.addEventListener("abort", cancel, { once: true });
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeout);
      if (external) external.removeEventListener("abort", cancel);
    },
  };
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function friendlyError(error: unknown, model: string): Error {
  const message = (error as Error)?.message || "Could not reach Ollama.";
  if (/abort|timed out/i.test(message)) return new Error(`Ollama did not answer within ${Math.round(config.ollamaTimeoutMs / 1000)} seconds. The note is queued for retry.`);
  return new Error(`Cannot reach Ollama at ${config.ollamaHost}. The note is queued for retry. ${message}`);
}

/** Native /api/chat, with bounded retries for temporary network and server failures. */
export async function chat(messages: ChatMessage[], tools: ToolSchema[], options: ChatOptions = {}): Promise<ChatMessage> {
  const model = options.model || config.model;
  let lastError: unknown;
  for (let attempt = 0; attempt <= config.ollamaRetries; attempt += 1) {
    const started = Date.now();
    const timed = timedSignal(config.ollamaTimeoutMs, options.signal);
    try {
      const res = await fetch(`${config.ollamaHost}/api/chat`, {
        method: "POST",
        headers: headers(),
        signal: timed.signal,
        body: JSON.stringify({
          model, messages, tools, stream: false, options: { temperature: 0.2 },
        }),
      });
      status.lastCheckedAt = new Date().toISOString();
      status.latencyMs = Date.now() - started;
      status.model = model;
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        if (res.status === 401 || res.status === 403) {
          throw Object.assign(new Error("Ollama rejected the key. Check OLLAMA_API_KEY or create a new key at ollama.com/settings/keys."), { retryable: false });
        }
        if (res.status === 404) {
          throw Object.assign(new Error(`Model "${model}" is not available on ${config.ollamaHost}.`), { retryable: false });
        }
        const retryable = res.status === 408 || res.status === 429 || res.status >= 500;
        throw Object.assign(new Error(`Ollama returned ${res.status}: ${detail.slice(0, 300)}`), { retryable });
      }
      const data: any = await res.json();
      status.state = "online";
      status.lastSuccessAt = new Date().toISOString();
      status.error = "";
      return { role: "assistant", content: data.message?.content || "", tool_calls: data.message?.tool_calls };
    } catch (error) {
      lastError = error;
      status.lastCheckedAt = new Date().toISOString();
      status.latencyMs = Date.now() - started;
      status.error = (error as Error).message || "Could not reach Ollama.";
      const retryable = (error as any).retryable !== false;
      status.state = attempt > 0 ? "degraded" : "offline";
      if (!retryable || attempt >= config.ollamaRetries || options.signal?.aborted) break;
      await wait(Math.min(2_000, 350 * (2 ** attempt)));
    } finally {
      timed.cleanup();
    }
  }
  throw friendlyError(lastError, model);
}

export async function checkOllamaHealth(): Promise<OllamaStatus> {
  const started = Date.now();
  const timed = timedSignal(5_000);
  try {
    const response = await fetch(`${config.ollamaHost}/api/tags`, { headers: headers(), signal: timed.signal });
    if (!response.ok) throw new Error(`Ollama returned ${response.status}.`);
    status.state = "online";
    status.error = "";
    status.lastSuccessAt = new Date().toISOString();
  } catch (error) {
    status.state = "offline";
    status.error = (error as Error).message;
  } finally {
    status.lastCheckedAt = new Date().toISOString();
    status.latencyMs = Date.now() - started;
    timed.cleanup();
  }
  return getOllamaStatus();
}
