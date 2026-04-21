/**
 * LLM Service - Call OpenAI-compatible API
 */

import { getPref } from "../utils/prefs";
import { Logger } from "../utils/logger";

export interface LLMConfig {
  apiKey: string;
  apiBase: string;
  model: string;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
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
    Logger.info("LLM", "Starting chat request", {
      model: this.config.model,
      apiBase: this.config.apiBase,
      apiKeySet: !!this.config.apiKey,
      streaming: !!onStream,
    });

    if (!this.config.apiKey) {
      Logger.error("LLM", "API Key not configured");
      throw new Error("API Key not configured. Please set it in preferences.");
    }

    const url = `${this.config.apiBase}/chat/completions`;

    // If streaming callback is provided, use streaming request
    if (onStream) {
      return this.chatStream(url, messages, onStream);
    }

    // Non-streaming request
    try {
      const requestBody = {
        model: this.config.model,
        messages: messages,
        stream: false,
      };
      Logger.debug("LLM", "Request", { url, messagesCount: messages.length });

      const response = await Zotero.HTTP.request("POST", url, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(requestBody),
        responseType: "json",
      });

      Logger.debug("LLM", "Response status", response.status);
      const data = response.response as any;

      if (data?.choices?.[0]?.message?.content) {
        const content = data.choices[0].message.content;
        Logger.info("LLM", "Success", { responseLength: content.length });
        return content;
      }

      Logger.error("LLM", "Invalid response structure", data);
      throw new Error("Invalid response from LLM API");
    } catch (error: any) {
      Logger.error("LLM", "API Error", {
        message: error.message,
        xmlhttpResponse: error?.xmlhttp?.response,
      });
      ztoolkit.log("LLM API Error:", error);
      if (error?.xmlhttp?.response) {
        const errorData = error.xmlhttp.response;
        throw new Error(
          `LLM API Error: ${errorData?.error?.message || JSON.stringify(errorData)}`,
        );
      }
      throw error;
    }
  }

  /**
   * Streaming request
   */
  private async chatStream(
    url: string,
    messages: ChatMessage[],
    onStream: (chunk: string, fullText: string) => void,
  ): Promise<string> {
    const requestBody = {
      model: this.config.model,
      messages: messages,
      stream: true,
    };

    Logger.debug("LLM", "Stream request", {
      url,
      messagesCount: messages.length,
    });

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", url, true);
      xhr.setRequestHeader("Content-Type", "application/json");
      xhr.setRequestHeader("Authorization", `Bearer ${this.config.apiKey}`);

      let fullText = "";
      let lastProcessedLength = 0;

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
              const delta = json.choices?.[0]?.delta?.content;
              if (delta) {
                fullText += delta;
                onStream(delta, fullText);
              }
            } catch (e) {
              // Ignore parse errors (may be incomplete JSON)
            }
          }
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          Logger.info("LLM", "Stream complete", {
            responseLength: fullText.length,
          });
          resolve(fullText);
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

      xhr.timeout = 60000; // 60 second timeout
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
