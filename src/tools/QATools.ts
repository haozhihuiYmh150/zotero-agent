/**
 * QA Tools - Handle user questions
 *
 * Features:
 * - Uses chat history for context continuity
 * - Supports single/multiple paper context
 * - Builds conversation messages for LLM
 */

import {
  BaseTool,
  ToolContext,
  ToolParams,
  ToolResult,
  StatusCallback,
  StreamCallback,
} from "./BaseTool";
import { PDFService } from "../services/PDFService";
import { LLMService } from "../services/LLMService";
import { ChatMessage, buildPapersDescription } from "../types";

/** Maximum number of history messages to include */
const MAX_HISTORY_MESSAGES = 10;

/**
 * Build LLM messages from chat history
 * Converts ChatMessage[] to LLM message format
 */
function buildHistoryMessages(
  chatHistory: ChatMessage[] | undefined,
  maxMessages: number = MAX_HISTORY_MESSAGES,
): Array<{ role: "user" | "assistant"; content: string }> {
  if (!chatHistory || chatHistory.length === 0) {
    return [];
  }

  // Take recent messages (excluding the current one which will be added separately)
  const recentHistory = chatHistory.slice(-maxMessages);

  return recentHistory.map((msg) => {
    let content = msg.content;

    // Add context info for user messages if available
    if (msg.isUser && msg.context) {
      const contextParts: string[] = [];

      // Add paper references
      if (msg.context.papers && msg.context.papers.length > 0) {
        contextParts.push(`[${buildPapersDescription(msg.context.papers)}]`);
      }

      // Add selected text indicator (not the full text, just a note)
      if (msg.context.selectedText) {
        const textPreview =
          msg.context.selectedText.length > 50
            ? msg.context.selectedText.substring(0, 50) + "..."
            : msg.context.selectedText;
        contextParts.push(`[Selected: "${textPreview}"]`);
      }

      if (contextParts.length > 0) {
        content = contextParts.join(" ") + "\n" + content;
      }
    }

    return {
      role: msg.isUser ? ("user" as const) : ("assistant" as const),
      content,
    };
  });
}

/**
 * Paper-related QA
 */
export class PaperQATool extends BaseTool {
  name = "paper_qa";
  description =
    "Answer questions about current paper(s). Used when user asks about paper content, methods, conclusions, etc.";
  parameters = [
    {
      name: "question",
      description: "User's question",
      required: true,
    },
  ];

  private llmService: LLMService;

  constructor(llmService: LLMService) {
    super();
    this.llmService = llmService;
  }

  async execute(
    params: ToolParams,
    context: ToolContext,
    callbacks: { onStatus?: StatusCallback; onStream?: StreamCallback },
  ): Promise<ToolResult> {
    const { question } = params;
    const { selectedItems, metadata, selectedText, allMetadata, chatHistory } =
      context;

    // Log context for debugging
    this.log("info", "=== Paper QA Context ===", {
      question,
      itemCount: selectedItems.length,
      hasSelection: !!selectedText,
      historyLength: chatHistory?.length || 0,
      maxHistoryUsed: MAX_HISTORY_MESSAGES,
    });

    try {
      let paperContext = "";

      // 1. Prioritize using selected text
      if (selectedText) {
        callbacks.onStatus?.("📋 已获取选中文本...");
        paperContext = `用户选中的文本：\n"""\n${selectedText}\n"""\n\n`;
      }

      // 2. Handle multiple papers
      if (selectedItems.length > 1) {
        callbacks.onStatus?.(`📚 正在读取 ${selectedItems.length} 篇论文...`);
        paperContext += `共选中 ${selectedItems.length} 篇论文：\n\n`;

        for (let i = 0; i < selectedItems.length; i++) {
          const item = selectedItems[i];
          const meta = allMetadata[i];

          paperContext += `--- 论文 ${i + 1} ---\n`;
          paperContext += `标题: ${meta?.title || "未知"}\n`;
          if (meta?.authors) paperContext += `作者: ${meta.authors}\n`;
          if (meta?.abstract) paperContext += `摘要: ${meta.abstract}\n`;
          paperContext += "\n";
        }
      } else if (selectedItems.length === 1 && metadata) {
        // 3. Single paper
        callbacks.onStatus?.("📄 正在读取论文...");
        paperContext += `当前论文：${metadata.title}\n`;
        if (metadata.authors) paperContext += `作者：${metadata.authors}\n`;
        if (metadata.abstract) paperContext += `摘要：${metadata.abstract}\n\n`;

        // 4. If no selected text, extract PDF content
        if (!selectedText) {
          callbacks.onStatus?.("📖 正在提取内容...");
          const pdfItem = await PDFService.getPDFAttachment(selectedItems[0]);
          if (pdfItem) {
            let fullText = await PDFService.extractFullText(pdfItem);
            fullText = PDFService.truncateText(fullText, 4000);
            paperContext += `论文内容：\n${fullText}\n\n`;
          }
        }
      }

      if (!paperContext) {
        return {
          success: false,
          error: "请先选中一篇或多篇论文，或在 PDF 中选择文本",
        };
      }

      callbacks.onStatus?.("🤔 思考中...");

      // Build messages with history
      const historyMessages = buildHistoryMessages(chatHistory);
      this.log("info", "Building LLM messages", {
        historyMessagesCount: historyMessages.length,
        paperContextLength: paperContext.length,
      });

      const systemPrompt = `你是 Zotero Agent，学术研究助手。基于提供的论文内容用中文简洁准确地回答问题。

当前论文上下文：
${paperContext}`;

      const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        { role: "system", content: systemPrompt },
        ...historyMessages,
        { role: "user", content: question },
      ];

      this.log("info", "Sending to LLM", {
        totalMessages: messages.length,
        roles: messages.map((m) => m.role),
      });

      let fullResponse = "";

      if (callbacks.onStream) {
        fullResponse = await this.llmService.chat(messages, callbacks.onStream);
      } else {
        fullResponse = await this.llmService.chat(messages);
      }

      this.log("info", "Paper QA complete", { length: fullResponse.length });

      return {
        success: true,
        message: fullResponse,
        streaming: !!callbacks.onStream,
      };
    } catch (error: any) {
      this.log("error", "Paper QA failed", error.message);
      return {
        success: false,
        error: `回答失败: ${error.message}`,
      };
    }
  }
}

/**
 * General QA
 */
export class GeneralQATool extends BaseTool {
  name = "general_qa";
  description = "Answer general academic questions. Used when question is not about current papers.";
  parameters = [
    {
      name: "question",
      description: "User's question",
      required: true,
    },
  ];

  private llmService: LLMService;

  constructor(llmService: LLMService) {
    super();
    this.llmService = llmService;
  }

  async execute(
    params: ToolParams,
    context: ToolContext,
    callbacks: { onStatus?: StatusCallback; onStream?: StreamCallback },
  ): Promise<ToolResult> {
    const { question } = params;
    const { chatHistory } = context;

    // Log context for debugging
    this.log("info", "=== General QA Context ===", {
      question,
      historyLength: chatHistory?.length || 0,
      maxHistoryUsed: MAX_HISTORY_MESSAGES,
    });

    callbacks.onStatus?.("🤔 思考中...");

    try {
      // Build messages with history
      const historyMessages = buildHistoryMessages(chatHistory);
      this.log("info", "Building LLM messages", {
        historyMessagesCount: historyMessages.length,
      });

      const systemPrompt =
        "你是 Zotero Agent，学术研究助手。用中文简洁回答用户的问题。如果用户问到之前对话中提到的内容，请基于对话历史回答。";

      const messages: Array<{ role: "system" | "user" | "assistant"; content: string }> = [
        { role: "system", content: systemPrompt },
        ...historyMessages,
        { role: "user", content: question },
      ];

      this.log("info", "Sending to LLM", {
        totalMessages: messages.length,
        roles: messages.map((m) => m.role),
      });

      let fullResponse = "";

      if (callbacks.onStream) {
        fullResponse = await this.llmService.chat(messages, callbacks.onStream);
      } else {
        fullResponse = await this.llmService.chat(messages);
      }

      this.log("info", "General QA complete", { length: fullResponse.length });

      return {
        success: true,
        message: fullResponse,
        streaming: !!callbacks.onStream,
      };
    } catch (error: any) {
      this.log("error", "General QA failed", error.message);
      return {
        success: false,
        error: `回答失败: ${error.message}`,
      };
    }
  }
}
