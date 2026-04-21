/**
 * Paper Summarize Tool
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

export class SummarizeTool extends BaseTool {
  name = "summarize";
  description = "总结内容。如果有选中文本则总结选中部分，否则总结整篇论文。";
  parameters = [];

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
    const { currentItem, metadata, selectedText } = context;

    // If there's selected text, prioritize summarizing selected content
    if (selectedText && selectedText.trim().length > 0) {
      return this.summarizeSelectedText(selectedText, metadata, callbacks);
    }

    // Otherwise summarize full paper
    if (!currentItem || !metadata) {
      return {
        success: false,
        error: "请先选中一篇论文，或在 PDF 中选择要总结的文本",
      };
    }

    return this.summarizeFullPaper(currentItem, metadata, callbacks);
  }

  /**
   * Summarize selected text
   */
  private async summarizeSelectedText(
    selectedText: string,
    metadata: ToolContext["metadata"],
    callbacks: { onStatus?: StatusCallback; onStream?: StreamCallback },
  ): Promise<ToolResult> {
    this.log("info", "Summarizing selected text", {
      length: selectedText.length,
    });
    callbacks.onStatus?.("📋 正在总结选中内容...");

    try {
      let context = `请总结以下选中的文本段落：\n\n"""\n${selectedText}\n"""`;
      if (metadata?.title) {
        context = `论文标题: ${metadata.title}\n\n` + context;
      }

      const systemPrompt = `你是学术论文助手。请用中文简洁总结用户选中的文本段落，提取要点。不需要按固定格式，根据内容灵活组织。`;

      let fullResponse = "";

      if (callbacks.onStream) {
        fullResponse = await this.llmService.chat(
          [
            { role: "system", content: systemPrompt },
            { role: "user", content: context },
          ],
          callbacks.onStream,
        );
      } else {
        fullResponse = await this.llmService.chat([
          { role: "system", content: systemPrompt },
          { role: "user", content: context },
        ]);
      }

      this.log("info", "Selected text summary complete", {
        length: fullResponse.length,
      });

      return {
        success: true,
        message: fullResponse,
        streaming: !!callbacks.onStream,
      };
    } catch (error: any) {
      this.log("error", "Selected text summary failed", error.message);
      return {
        success: false,
        error: `总结失败: ${error.message}`,
      };
    }
  }

  /**
   * Summarize full paper
   */
  private async summarizeFullPaper(
    currentItem: Zotero.Item,
    metadata: NonNullable<ToolContext["metadata"]>,
    callbacks: { onStatus?: StatusCallback; onStream?: StreamCallback },
  ): Promise<ToolResult> {
    this.log("info", "Summarizing full paper", { title: metadata.title });
    callbacks.onStatus?.("📖 正在提取论文内容...");

    try {
      // Build paper context
      let paperContext = `论文标题: ${metadata.title}\n`;
      if (metadata.authors) paperContext += `作者: ${metadata.authors}\n`;
      if (metadata.year) paperContext += `年份: ${metadata.year}\n`;
      if (metadata.abstract) paperContext += `摘要: ${metadata.abstract}\n\n`;

      // Extract PDF full text
      const pdfItem = await PDFService.getPDFAttachment(currentItem);
      if (pdfItem) {
        let fullText = await PDFService.extractFullText(pdfItem);
        fullText = PDFService.truncateText(fullText, 6000);
        paperContext += `论文内容:\n${fullText}\n`;
      }

      callbacks.onStatus?.("📝 正在生成总结...");

      // Streaming summary generation
      const systemPrompt = `你是学术论文助手。请用中文总结论文，包括：
1) 研究问题 - 论文试图解决什么问题
2) 主要方法 - 使用了什么技术或方法
3) 关键发现 - 主要实验结果或发现
4) 主要贡献 - 对领域的贡献是什么`;

      let fullResponse = "";

      if (callbacks.onStream) {
        fullResponse = await this.llmService.chat(
          [
            { role: "system", content: systemPrompt },
            { role: "user", content: paperContext },
          ],
          callbacks.onStream,
        );
      } else {
        fullResponse = await this.llmService.chat([
          { role: "system", content: systemPrompt },
          { role: "user", content: paperContext },
        ]);
      }

      this.log("info", "Full paper summary complete", {
        length: fullResponse.length,
      });

      return {
        success: true,
        message: fullResponse,
        streaming: !!callbacks.onStream,
      };
    } catch (error: any) {
      this.log("error", "Full paper summary failed", error.message);
      return {
        success: false,
        error: `总结失败: ${error.message}`,
      };
    }
  }
}
