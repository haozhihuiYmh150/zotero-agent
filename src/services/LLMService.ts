/**
 * LLM Service - Call OpenAI-compatible API
 *
 * Supports:
 * - Streaming responses
 * - Function Calling / Tool Use
 * - Streaming + Tool Use (content streams, tool_calls accumulated)
 */

import { getPref } from "../utils/prefs";
import { Logger } from "../utils/logger";

export interface LLMConfig {
  apiKey: string;
  apiBase: string;
  model: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: {
      type: "object";
      properties: Record<string, any>;
      required?: string[];
    };
  };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatCompletionResponse {
  content: string | null;
  tool_calls?: ToolCall[];
}

export class LLMService {
  private config: LLMConfig;

  constructor(config?: Partial<LLMConfig>) {
    this.config = {
      apiKey: (getPref("llm.apiKey") as string) || "",
      apiBase: (getPref("llm.apiBase") as string) || "",
      model: (getPref("llm.model") as string) || "",
      ...config,
    };
  }

  /**
   * Send chat request (supports streaming)
   */
  async chat(
    messages: ChatMessage[],
    onStream?: (chunk: string, fullText: string) => void,
  ): Promise<string> {
    const result = await this.chatWithToolsStream(messages, undefined, onStream);
    return result.content || "";
  }

  /**
   * Send chat request with tools (non-streaming, for backward compatibility)
   */
  async chatWithTools(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
  ): Promise<ChatCompletionResponse> {
    return this.chatWithToolsStream(messages, tools, undefined);
  }

  /**
   * Send chat request with tools and streaming support
   *
   * Behavior:
   * - Content is streamed in real-time via onStream callback
   * - Tool calls are accumulated and returned at the end
   * - If LLM returns tool_calls, content may be partial or empty
   */
  async chatWithToolsStream(
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    onStream?: (chunk: string, fullText: string) => void,
  ): Promise<ChatCompletionResponse> {
    Logger.info("LLM", "Starting chat request", {
      model: this.config.model,
      apiBase: this.config.apiBase,
      apiKeySet: !!this.config.apiKey,
      streaming: !!onStream,
      toolsCount: tools?.length || 0,
    });

    if (!this.config.apiKey) {
      Logger.error("LLM", "API Key not configured");
      throw new Error("API Key not configured. Please set it in preferences.");
    }

    const url = `${this.config.apiBase}/chat/completions`;

    // Use streaming for all requests (better UX)
    return this.streamWithTools(url, messages, tools, onStream);
  }

  /**
   * Streaming request with tool support
   *
   * Parses SSE stream, accumulates content and tool_calls
   */
  private async streamWithTools(
    url: string,
    messages: ChatMessage[],
    tools?: ToolDefinition[],
    onStream?: (chunk: string, fullText: string) => void,
  ): Promise<ChatCompletionResponse> {
    const requestBody: any = {
      model: this.config.model,
      messages: messages,
      stream: true,
    };

    if (tools && tools.length > 0) {
      requestBody.tools = tools;
    }

    Logger.debug("LLM", "Stream request with tools", {
      url,
      messagesCount: messages.length,
      tools: tools?.map((t) => t.function.name),
    });

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url, true);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.setRequestHeader("Authorization", `Bearer ${this.config.apiKey}`);

      let fullContent = "";
      let lastProcessedLength = 0;

      // Accumulate tool calls (streaming tool_calls come in parts)
      const toolCallsMap: Map<
        number,
        { id: string; type: string; function: { name: string; arguments: string } }
      > = new Map();

      xhr.onprogress = () => {
        const responseText = xhr.responseText || "";
        const newData = responseText.substring(lastProcessedLength);
        lastProcessedLength = responseText.length;

        // Parse SSE data
        const lines = newData.split("\n");
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const data = line.substring(6).trim();
            if (data === "[DONE]") {
              continue;
            }
            try {
              const json = JSON.parse(data);
              const delta = json.choices?.[0]?.delta;

              if (!delta) continue;

              // Handle content delta
              if (delta.content) {
                fullContent += delta.content;
                if (onStream) {
                  onStream(delta.content, fullContent);
                }
              }

              // Handle tool_calls delta
              if (delta.tool_calls) {
                for (const tc of delta.tool_calls) {
                  const index = tc.index ?? 0;

                  if (!toolCallsMap.has(index)) {
                    // New tool call
                    toolCallsMap.set(index, {
                      id: tc.id || "",
                      type: tc.type || "function",
                      function: {
                        name: tc.function?.name || "",
                        arguments: tc.function?.arguments || "",
                      },
                    });
                  } else {
                    // Update existing tool call
                    const existing = toolCallsMap.get(index)!;
                    if (tc.id) existing.id = tc.id;
                    if (tc.type) existing.type = tc.type;
                    if (tc.function?.name) existing.function.name += tc.function.name;
                    if (tc.function?.arguments)
                      existing.function.arguments += tc.function.arguments;
                  }
                }
              }
            } catch (e) {
              // Ignore parse errors (may be incomplete JSON)
            }
          }
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          // Convert tool calls map to array
          const toolCalls: ToolCall[] = [];
          const sortedIndices = Array.from(toolCallsMap.keys()).sort((a, b) => a - b);
          for (const index of sortedIndices) {
            const tc = toolCallsMap.get(index)!;
            if (tc.id && tc.function.name) {
              toolCalls.push({
                id: tc.id,
                type: "function",
                function: {
                  name: tc.function.name,
                  arguments: tc.function.arguments,
                },
              });
            }
          }

          Logger.info("LLM", "Stream complete", {
            contentLength: fullContent.length,
            toolCallsCount: toolCalls.length,
            toolNames: toolCalls.map((tc) => tc.function.name),
          });

          resolve({
            content: fullContent || null,
            tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
          });
        } else {
          Logger.error("LLM", "Stream error", {
            status: xhr.status,
            response: xhr.responseText,
          });
          try {
            const errorData = JSON.parse(xhr.responseText || "{}");
            reject(
              new Error(
                `LLM API Error: ${errorData?.error?.message || xhr.statusText}`,
              ),
            );
          } catch {
            reject(new Error(`LLM API Error: ${xhr.statusText}`));
          }
        }
      };

      xhr.onerror = () => {
        Logger.error("LLM", "Stream network error");
        reject(new Error("Network error"));
      };

      xhr.ontimeout = () => {
        Logger.error("LLM", "Stream timeout");
        reject(new Error("Request timeout"));
      };

      xhr.timeout = 120000; // 120 second timeout
      xhr.send(JSON.stringify(requestBody));
    });
  }

  /**
   * Summarize text
   */
  async summarize(text: string, language: string = "zh"): Promise<string> {
    const systemPrompt =
      language === "zh"
        ? "你是一个学术论文助手。请用简洁的中文总结以下内容，保留关键信息。"
        : "You are an academic paper assistant. Please summarize the following content concisely, keeping key information.";

    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: `请总结以下内容：\n\n${text}` },
    ];

    return this.chat(messages);
  }

  /**
   * Test connection
   */
  async testConnection(): Promise<boolean> {
    try {
      Logger.info("LLM", "Testing connection...");
      const response = await this.chat([{ role: "user", content: "Hello" }]);
      Logger.info("LLM", "Connection test success");
      return response.length > 0;
    } catch (e: any) {
      Logger.error("LLM", "Connection test failed", e.message);
      return false;
    }
  }
}
