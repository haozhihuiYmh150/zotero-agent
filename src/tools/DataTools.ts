/**
 * Data Tools - Tools that only fetch/return data (no LLM calls)
 *
 * Following Function Calling best practices:
 * - Tools only retrieve data or perform actions
 * - LLM handles all reasoning and response generation
 *
 * Context Proximity Design (近 → 远):
 * - Chat history (most recent, clearest intent)
 * - Selected items (explicit user selection)
 * - Library (largest scope, may have ambiguity)
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

/**
 * Get content of paper(s) - supports context proximity lookup
 *
 * Priority (近 → 远):
 * 1. arxiv_id/pmid parameter (from chat history, most specific)
 * 2. Selected text in PDF
 * 3. Selected paper(s)
 * 4. Error: ask user to select
 */
export class GetPaperContentTool extends BaseTool {
  name = "get_paper_content";
  description =
    "Get content of paper(s). Can specify arxiv_id or pmid for recently downloaded papers, or read currently selected papers.";
  parameters = [
    {
      name: "arxiv_id",
      description: "arXiv ID of paper (e.g., '2211.15444'). Use this for papers just downloaded in chat history.",
      required: false,
    },
    {
      name: "pmid",
      description: "PubMed ID of paper (e.g., '12345678'). Use this for papers just downloaded from PubMed.",
      required: false,
    },
  ];

  async execute(
    params: ToolParams,
    context: ToolContext,
    callbacks: { onStatus?: StatusCallback; onStream?: StreamCallback },
  ): Promise<ToolResult> {
    const { selectedItems, metadata, selectedText, allMetadata } = context;
    const arxivId = params.arxiv_id as string | undefined;
    const pmid = params.pmid as string | undefined;

    this.log("info", "=== GetPaperContent START ===", {
      arxivId,
      pmid,
      itemCount: selectedItems.length,
      hasSelectedText: !!selectedText,
    });

    // Priority 0a: arxiv_id from chat history (most specific - context proximity)
    if (arxivId) {
      this.log("info", "Mode: ARXIV_ID_LOOKUP", { arxivId });
      callbacks.onStatus?.(`🔍 在库中查找 arXiv:${arxivId}...`);

      const item = await this.findByArxivId(arxivId);
      if (item) {
        return this.extractSinglePaper(item, callbacks);
      } else {
        this.log("warn", "Paper not found in library", { arxivId });
        return {
          success: false,
          error: `未在库中找到 arXiv:${arxivId}，可能还未下载完成。请稍后重试或在 Zotero 中选中该论文。`,
        };
      }
    }

    // Priority 0b: pmid from chat history
    if (pmid) {
      this.log("info", "Mode: PMID_LOOKUP", { pmid });
      callbacks.onStatus?.(`🔍 在库中查找 PMID:${pmid}...`);

      const item = await this.findByPmid(pmid);
      if (item) {
        return this.extractSinglePaper(item, callbacks);
      } else {
        this.log("warn", "Paper not found in library", { pmid });
        return {
          success: false,
          error: `未在库中找到 PMID:${pmid}，可能还未下载完成。请稍后重试或在 Zotero 中选中该论文。`,
        };
      }
    }

    // Priority 1: Selected text in PDF
    if (selectedText && selectedText.trim().length > 0) {
      this.log("info", "Mode: SELECTED_TEXT", { length: selectedText.length });
      callbacks.onStatus?.("📋 获取选中文本...");

      let content = `## 用户选中的文本\n\n${selectedText}`;
      if (metadata?.title) {
        content = `来自论文: "${metadata.title}"\n\n` + content;
      }

      this.log("info", "=== GetPaperContent END (selected_text) ===");
      return {
        success: true,
        data: { type: "selected_text", content },
        message: content,
      };
    }

    // Priority 2: Multiple papers - return abstracts
    if (selectedItems.length > 1) {
      this.log("info", "Mode: MULTIPLE_PAPERS", { count: selectedItems.length });
      callbacks.onStatus?.(`📚 获取 ${selectedItems.length} 篇论文信息...`);

      let content = `## ${selectedItems.length} 篇论文\n\n`;

      for (let i = 0; i < selectedItems.length; i++) {
        const meta = allMetadata[i];
        content += `### 论文 ${i + 1}: ${meta?.title || "未知"}\n`;
        if (meta?.authors) content += `- 作者: ${meta.authors}\n`;
        if (meta?.year) content += `- 年份: ${meta.year}\n`;
        if (meta?.abstract) content += `- 摘要: ${meta.abstract}\n`;
        content += "\n";
      }

      this.log("info", "=== GetPaperContent END (multiple_papers) ===");
      return {
        success: true,
        data: { type: "multiple_papers", count: selectedItems.length, content },
        message: content,
      };
    }

    // Priority 3: Single selected paper - return full content
    if (selectedItems.length === 1 && metadata) {
      this.log("info", "Mode: SINGLE_PAPER", { title: metadata.title });
      return this.extractSinglePaper(selectedItems[0], callbacks);
    }

    // No context available
    this.log("warn", "=== GetPaperContent END (no selection) ===");
    return {
      success: false,
      error: "没有选中论文。请在 Zotero 中选中论文，或提供 arXiv ID / PMID。",
    };
  }

  /**
   * Find paper in library by arXiv ID
   */
  private async findByArxivId(arxivId: string): Promise<Zotero.Item | null> {
    try {
      // Search by archiveID field (format: "arXiv:2211.15444")
      const s = new Zotero.Search();
      s.addCondition("archiveID", "contains", arxivId);

      const ids = await s.search();
      this.log("info", "Search by archiveID", { arxivId, found: ids.length });

      if (ids.length > 0) {
        return Zotero.Items.get(ids[0]);
      }

      // Fallback: search by DOI (format: "10.48550/arXiv.2211.15444")
      const s2 = new Zotero.Search();
      s2.addCondition("DOI", "contains", arxivId);

      const ids2 = await s2.search();
      this.log("info", "Search by DOI", { arxivId, found: ids2.length });

      if (ids2.length > 0) {
        return Zotero.Items.get(ids2[0]);
      }

      return null;
    } catch (e: any) {
      this.log("error", "Search failed", e.message);
      return null;
    }
  }

  /**
   * Find paper in library by PubMed ID (stored in extra field as "PMID: xxx")
   */
  private async findByPmid(pmid: string): Promise<Zotero.Item | null> {
    try {
      // Search by extra field (format: "PMID: 12345678")
      const s = new Zotero.Search();
      s.addCondition("extra", "contains", `PMID: ${pmid}`);

      const ids = await s.search();
      this.log("info", "Search by PMID in extra", { pmid, found: ids.length });

      if (ids.length > 0) {
        return Zotero.Items.get(ids[0]);
      }

      // Fallback: search without space (in case of different formats)
      const s2 = new Zotero.Search();
      s2.addCondition("extra", "contains", `PMID:${pmid}`);

      const ids2 = await s2.search();
      this.log("info", "Search by PMID (no space)", { pmid, found: ids2.length });

      if (ids2.length > 0) {
        return Zotero.Items.get(ids2[0]);
      }

      return null;
    } catch (e: any) {
      this.log("error", "Search by PMID failed", e.message);
      return null;
    }
  }

  /**
   * Extract content from a single paper
   */
  private async extractSinglePaper(
    item: Zotero.Item,
    callbacks: { onStatus?: StatusCallback; onStream?: StreamCallback },
  ): Promise<ToolResult> {
    callbacks.onStatus?.("📄 获取论文内容...");

    const title = item.getField("title") as string;
    const creators = item.getCreators();
    const authors = creators.map((c: any) => `${c.firstName} ${c.lastName}`).join(", ");
    const year = item.getField("year") as string;
    const abstract = item.getField("abstractNote") as string;

    let content = `## 论文: ${title}\n\n`;
    if (authors) content += `- 作者: ${authors}\n`;
    if (year) content += `- 年份: ${year}\n`;
    if (abstract) content += `- 摘要: ${abstract}\n\n`;

    // Extract PDF full text
    this.log("info", "Getting PDF attachment...");
    const pdfItem = await PDFService.getPDFAttachment(item);
    if (pdfItem) {
      callbacks.onStatus?.("📖 提取 PDF 内容...");
      this.log("info", "Extracting PDF full text...");
      let fullText = await PDFService.extractFullText(pdfItem);
      const originalLength = fullText.length;
      fullText = PDFService.truncateText(fullText, 6000);
      this.log("info", "PDF text extracted", {
        originalLength,
        truncatedLength: fullText.length,
      });
      content += `### 论文内容\n\n${fullText}`;
    } else {
      this.log("warn", "No PDF attachment found");
    }

    this.log("info", "=== GetPaperContent END (single_paper) ===", {
      title,
      contentLength: content.length,
    });

    return {
      success: true,
      data: { type: "single_paper", title, content },
      message: content,
    };
  }
}

/**
 * Get abstracts of many papers (for batch analysis)
 * Used when user selects many papers (>10)
 */
export class GetPaperAbstractsTool extends BaseTool {
  name = "get_paper_abstracts";
  description =
    "Get abstracts of all selected papers. Use this for batch analysis of many papers.";
  parameters = [];

  async execute(
    params: ToolParams,
    context: ToolContext,
    callbacks: { onStatus?: StatusCallback; onStream?: StreamCallback },
  ): Promise<ToolResult> {
    const { selectedItems, allMetadata } = context;

    this.log("info", "=== GetPaperAbstracts START ===", {
      itemCount: selectedItems.length,
    });

    if (selectedItems.length === 0) {
      this.log("warn", "=== GetPaperAbstracts END (no selection) ===");
      return {
        success: false,
        error: "没有选中论文。",
      };
    }

    callbacks.onStatus?.(`📚 获取 ${selectedItems.length} 篇论文摘要...`);

    let content = `## ${selectedItems.length} 篇论文摘要\n\n`;
    let withAbstract = 0;

    for (let i = 0; i < selectedItems.length; i++) {
      const meta = allMetadata[i];
      content += `### ${i + 1}. ${meta?.title || "未知"}\n`;
      if (meta?.authors) content += `作者: ${meta.authors}`;
      if (meta?.year) content += ` (${meta.year})`;
      content += "\n";

      if (meta?.abstract) {
        content += `摘要: ${meta.abstract}\n`;
        withAbstract++;
      } else {
        content += `(无摘要)\n`;
      }
      content += "\n";
    }

    this.log("info", "=== GetPaperAbstracts END ===", {
      total: selectedItems.length,
      withAbstract,
      contentLength: content.length,
    });

    return {
      success: true,
      data: {
        type: "abstracts",
        count: selectedItems.length,
        withAbstract,
        content,
      },
      message: content,
    };
  }
}
