/**
 * Paper Summarize Tool
 *
 * Supports batch summarization for multiple papers:
 * - Single paper: Extract full text and summarize
 * - Multiple papers (≤10): Use abstracts directly
 * - Many papers (>10): Batch processing then synthesis
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

/** Threshold for switching to batch processing */
const BATCH_THRESHOLD = 10;
/** Papers per batch for hierarchical summarization */
const BATCH_SIZE = 5;

export class SummarizeTool extends BaseTool {
  name = "summarize";
  description = "总结内容。如果有选中文本则总结选中部分，否则总结选中的论文（支持多篇，使用分批摘要）。";
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
    const { selectedItems, metadata, selectedText, allMetadata } = context;

    // Log strategy decision
    this.log("info", "=== Summarize Strategy Decision ===", {
      selectedItemsCount: selectedItems.length,
      hasSelectedText: !!selectedText,
      batchThreshold: BATCH_THRESHOLD,
      batchSize: BATCH_SIZE,
    });

    // If there's selected text, prioritize summarizing selected content
    if (selectedText && selectedText.trim().length > 0) {
      this.log("info", "Strategy: SELECTED_TEXT", {
        textLength: selectedText.length,
      });
      return this.summarizeSelectedText(selectedText, metadata, callbacks);
    }

    // Check if multiple papers selected
    if (selectedItems.length > BATCH_THRESHOLD) {
      // Many papers: use batch summarization
      this.log("info", "Strategy: BATCH (batch processing)", {
        paperCount: selectedItems.length,
        batchCount: Math.ceil(selectedItems.length / BATCH_SIZE),
        reason: `paperCount(${selectedItems.length}) > BATCH_THRESHOLD(${BATCH_THRESHOLD})`,
      });
      return this.batchSummarize(selectedItems, allMetadata, callbacks);
    } else if (selectedItems.length > 1) {
      // Multiple papers (≤10): direct summarization
      this.log("info", "Strategy: DIRECT_MULTIPLE (use abstracts)", {
        paperCount: selectedItems.length,
        reason: `1 < paperCount(${selectedItems.length}) <= BATCH_THRESHOLD(${BATCH_THRESHOLD})`,
      });
      return this.summarizeMultiplePapers(selectedItems, allMetadata, callbacks);
    }

    // Single paper
    if (selectedItems.length === 1 && metadata) {
      this.log("info", "Strategy: SINGLE_PAPER (extract full text)", {
        title: metadata.title,
      });
      return this.summarizeFullPaper(selectedItems[0], metadata, callbacks);
    }

    this.log("warn", "Strategy: NONE (no items selected)");
    return {
      success: false,
      error: "请先选中一篇或多篇论文，或在 PDF 中选择要总结的文本",
    };
  }

  /**
   * Batch summarization for many papers (>10)
   * Phase 1: Summarize each batch of papers
   * Phase 2: Synthesize all batch summaries
   */
  private async batchSummarize(
    items: Zotero.Item[],
    allMetadata: ToolContext["allMetadata"],
    callbacks: { onStatus?: StatusCallback; onStream?: StreamCallback },
  ): Promise<ToolResult> {
    this.log("info", "=== Batch Summarization START ===", {
      totalPapers: items.length,
      batchSize: BATCH_SIZE,
      expectedBatches: Math.ceil(items.length / BATCH_SIZE),
    });
    callbacks.onStatus?.(`📚 开始分批摘要 ${items.length} 篇论文...`);

    try {
      // Phase 1: Batch summarization
      const batches: Array<{ items: Zotero.Item[]; metadata: typeof allMetadata }> = [];
      for (let i = 0; i < items.length; i += BATCH_SIZE) {
        batches.push({
          items: items.slice(i, i + BATCH_SIZE),
          metadata: allMetadata.slice(i, i + BATCH_SIZE),
        });
      }

      this.log("info", "Phase 1: Batch processing", {
        batchCount: batches.length,
        batchSizes: batches.map(b => b.items.length),
      });
      callbacks.onStatus?.(`📊 第一阶段：分 ${batches.length} 批处理...`);

      const batchSummaries: string[] = [];
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const batchPapers = batch.metadata.map(m => m?.title || "未知");

        this.log("info", `Processing batch ${i + 1}/${batches.length}`, {
          batchIndex: i + 1,
          paperCount: batch.items.length,
          papers: batchPapers,
          hasAbstracts: batch.metadata.map(m => !!m?.abstract),
        });
        callbacks.onStatus?.(`📝 处理第 ${i + 1}/${batches.length} 批 (${batch.items.length} 篇)...`);

        // Build batch context using abstracts
        let batchContext = `第 ${i + 1} 批，共 ${batch.items.length} 篇论文：\n\n`;
        let abstractCount = 0;
        for (let j = 0; j < batch.items.length; j++) {
          const meta = batch.metadata[j];
          batchContext += `论文 ${j + 1}: ${meta?.title || "未知"}\n`;
          if (meta?.authors) batchContext += `作者: ${meta.authors}\n`;
          if (meta?.year) batchContext += `年份: ${meta.year}\n`;
          if (meta?.abstract) {
            batchContext += `摘要: ${meta.abstract}\n`;
            abstractCount++;
          }
          batchContext += "\n";
        }

        this.log("info", `Batch ${i + 1} context built`, {
          batchIndex: i + 1,
          contextLength: batchContext.length,
          abstractsUsed: abstractCount,
          estimatedTokens: Math.ceil(batchContext.length / 2),
        });

        // Get batch summary (non-streaming for intermediate results)
        const batchSummary = await this.llmService.chat([
          {
            role: "system",
            content: `你是学术论文助手。请用中文简要总结这批论文的主要内容和共同主题，200字以内。`,
          },
          { role: "user", content: batchContext },
        ]);

        this.log("info", `Batch ${i + 1} summary generated`, {
          batchIndex: i + 1,
          summaryLength: batchSummary.length,
        });

        batchSummaries.push(`**第 ${i + 1} 批 (${batch.items.length} 篇)：**\n${batchSummary}`);
      }

      // Phase 2: Synthesize all batch summaries
      this.log("info", "Phase 2: Synthesis", {
        batchSummaryCount: batchSummaries.length,
        totalSummaryLength: batchSummaries.join("").length,
      });
      callbacks.onStatus?.(`🔄 第二阶段：综合分析...`);

      const synthesisContext = `共 ${items.length} 篇论文，分 ${batches.length} 批处理后的摘要：\n\n${batchSummaries.join("\n\n")}`;

      this.log("info", "Synthesis context built", {
        contextLength: synthesisContext.length,
        estimatedTokens: Math.ceil(synthesisContext.length / 2),
      });

      const systemPrompt = `你是学术论文助手。用户选中了大量论文（${items.length}篇），已分批预处理。请基于各批摘要，用中文进行综合分析：

1) 主题概述 - 这些论文的共同研究领域
2) 关键发现 - 最重要的发现或贡献
3) 研究脉络 - 如果能看出发展趋势，请说明
4) 研究空白 - 如果能发现潜在的研究空白，请指出

注意：请保持各部分格式统一，避免对某些内容使用粗体/标题而其他不用。`;

      let fullResponse = "";

      if (callbacks.onStream) {
        fullResponse = await this.llmService.chat(
          [
            { role: "system", content: systemPrompt },
            { role: "user", content: synthesisContext },
          ],
          callbacks.onStream,
        );
      } else {
        fullResponse = await this.llmService.chat([
          { role: "system", content: systemPrompt },
          { role: "user", content: synthesisContext },
        ]);
      }

      this.log("info", "Batch summarization complete", {
        count: items.length,
        batches: batches.length,
        length: fullResponse.length,
      });

      return {
        success: true,
        message: fullResponse,
        streaming: !!callbacks.onStream,
      };
    } catch (error: any) {
      this.log("error", "Batch summarization failed", error.message);
      return {
        success: false,
        error: `分批摘要失败: ${error.message}`,
      };
    }
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

  /**
   * Summarize multiple papers
   */
  private async summarizeMultiplePapers(
    items: Zotero.Item[],
    allMetadata: ToolContext["allMetadata"],
    callbacks: { onStatus?: StatusCallback; onStream?: StreamCallback },
  ): Promise<ToolResult> {
    this.log("info", "Summarizing multiple papers", { count: items.length });
    callbacks.onStatus?.(`📚 正在提取 ${items.length} 篇论文内容...`);

    try {
      // Build context for all papers (use abstracts to save tokens)
      let papersContext = `共选中 ${items.length} 篇论文：\n\n`;

      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const meta = allMetadata[i];

        papersContext += `--- 论文 ${i + 1} ---\n`;
        papersContext += `标题: ${meta?.title || "未知"}\n`;
        if (meta?.authors) papersContext += `作者: ${meta.authors}\n`;
        if (meta?.year) papersContext += `年份: ${meta.year}\n`;
        if (meta?.abstract) {
          papersContext += `摘要: ${meta.abstract}\n`;
        } else {
          // If no abstract, try to extract first part of PDF
          const pdfItem = await PDFService.getPDFAttachment(item);
          if (pdfItem) {
            let fullText = await PDFService.extractFullText(pdfItem);
            fullText = PDFService.truncateText(fullText, 1500); // Shorter for multiple papers
            papersContext += `内容摘要: ${fullText}\n`;
          }
        }
        papersContext += "\n";
      }

      callbacks.onStatus?.("📝 正在生成综合总结...");

      const systemPrompt = `你是学术论文助手。用户选中了多篇论文，请用中文进行综合分析：

1) 主题概述 - 这些论文的共同研究领域是什么
2) 各论文要点 - 简要说明每篇论文的核心贡献（每篇用相同格式：论文N：一句话概括）
3) 关联分析 - 这些论文之间有什么联系或区别
4) 研究趋势 - 如果能看出研究发展脉络，请简要说明

注意：请保持各部分格式统一，避免对某些论文使用粗体/标题而其他不用。`;

      let fullResponse = "";

      if (callbacks.onStream) {
        fullResponse = await this.llmService.chat(
          [
            { role: "system", content: systemPrompt },
            { role: "user", content: papersContext },
          ],
          callbacks.onStream,
        );
      } else {
        fullResponse = await this.llmService.chat([
          { role: "system", content: systemPrompt },
          { role: "user", content: papersContext },
        ]);
      }

      this.log("info", "Multiple papers summary complete", {
        count: items.length,
        length: fullResponse.length,
      });

      return {
        success: true,
        message: fullResponse,
        streaming: !!callbacks.onStream,
      };
    } catch (error: any) {
      this.log("error", "Multiple papers summary failed", error.message);
      return {
        success: false,
        error: `总结失败: ${error.message}`,
      };
    }
  }
}
