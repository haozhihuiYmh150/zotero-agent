/**
 * QA Tools - Handle user questions
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

/**
 * Paper-related QA
 */
export class PaperQATool extends BaseTool {
  name = "paper_qa";
  description =
    "回答关于当前论文的问题。当用户询问论文内容、方法、结论等时使用。";
  parameters = [
    {
      name: "question",
      description: "用户的问题",
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
    const { currentItem, metadata, selectedText } = context;

    this.log("info", "Paper QA", {
      question,
      hasItem: !!currentItem,
      hasSelection: !!selectedText,
    });

    try {
      let paperContext = "";

      // 1. Prioritize using selected text
      if (selectedText) {
        callbacks.onStatus?.("📋 已获取选中文本...");
        paperContext = `用户选中的文本：\n"""\n${selectedText}\n"""\n\n`;
      }

      // 2. Add paper metadata
      if (currentItem && metadata) {
        callbacks.onStatus?.("📄 正在读取论文...");
        paperContext += `当前论文：${metadata.title}\n`;
        if (metadata.authors) paperContext += `作者：${metadata.authors}\n`;
        if (metadata.abstract) paperContext += `摘要：${metadata.abstract}\n\n`;

        // 3. If no selected text, extract PDF content
        if (!selectedText) {
          callbacks.onStatus?.("📖 正在提取内容...");
          const pdfItem = await PDFService.getPDFAttachment(currentItem);
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
          error: "请先选中一篇论文或在 PDF 中选择文本",
        };
      }

      callbacks.onStatus?.("🤔 思考中...");

      const systemPrompt =
        "你是 Zotero Agent，学术研究助手。基于提供的论文内容用中文简洁准确地回答问题。";

      let fullResponse = "";

      if (callbacks.onStream) {
        fullResponse = await this.llmService.chat(
          [
            { role: "system", content: systemPrompt },
            { role: "user", content: paperContext + "问题：" + question },
          ],
          callbacks.onStream,
        );
      } else {
        fullResponse = await this.llmService.chat([
          { role: "system", content: systemPrompt },
          { role: "user", content: paperContext + "问题：" + question },
        ]);
      }

      this.log("info", "QA complete", { length: fullResponse.length });

      return {
        success: true,
        message: fullResponse,
        streaming: !!callbacks.onStream,
      };
    } catch (error: any) {
      this.log("error", "QA failed", error.message);
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
  description = "回答通用学术问题。当问题与当前论文无关时使用。";
  parameters = [
    {
      name: "question",
      description: "用户的问题",
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

    this.log("info", "General QA", { question });
    callbacks.onStatus?.("🤔 思考中...");

    try {
      const systemPrompt =
        "你是 Zotero Agent，学术研究助手。用中文简洁回答用户的问题。";

      let fullResponse = "";

      if (callbacks.onStream) {
        fullResponse = await this.llmService.chat(
          [
            { role: "system", content: systemPrompt },
            { role: "user", content: question },
          ],
          callbacks.onStream,
        );
      } else {
        fullResponse = await this.llmService.chat([
          { role: "system", content: systemPrompt },
          { role: "user", content: question },
        ]);
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
