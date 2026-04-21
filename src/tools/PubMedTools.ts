/**
 * PubMed Tools - Search and download papers from PubMed
 */

import {
  BaseTool,
  ToolContext,
  ToolParams,
  ToolResult,
  StatusCallback,
  StreamCallback,
} from "./BaseTool";
import { PubMedService, PubMedPaper } from "../services/PubMedService";

export class PubMedSearchTool extends BaseTool {
  name = "pubmed_search";
  description = "在 PubMed 上搜索生物医学论文。当用户想要查找医学、生物学相关文献时使用。";
  parameters = [
    {
      name: "keywords",
      description: "搜索关键词（英文效果最好）",
      required: true,
    },
    {
      name: "maxResults",
      description: "返回结果数量，默认 5",
      required: false,
    },
  ];

  // Save recent search results for downloading
  private static lastResults: PubMedPaper[] = [];

  static getLastResults(): PubMedPaper[] {
    return this.lastResults;
  }

  async execute(
    params: ToolParams,
    context: ToolContext,
    callbacks: { onStatus?: StatusCallback; onStream?: StreamCallback },
  ): Promise<ToolResult> {
    const { keywords, maxResults = 5 } = params;

    if (!keywords) {
      return {
        success: false,
        error: "请提供搜索关键词",
      };
    }

    this.log("info", "Searching", { keywords, maxResults });
    callbacks.onStatus?.(`🔍 正在搜索 PubMed: ${keywords}`);

    try {
      const result = await PubMedService.search(keywords, maxResults);
      PubMedSearchTool.lastResults = result.papers;

      if (result.papers.length === 0) {
        return {
          success: true,
          message: `未找到与 "${keywords}" 相关的论文`,
          data: { papers: [] },
        };
      }

      // Check if we should show rate limit reminder
      const showReminder = PubMedService.shouldShowRateLimitReminder();

      // Format results
      let message = `**PubMed 搜索结果** (${keywords})\n`;
      if (showReminder) {
        message += `> ⚠️ PubMed 有频率限制，请勿短时间内大量搜索\n`;
      }
      message += `\n🆓 = 有免费全文(PMC)\n\n`;

      result.papers.forEach((paper, index) => {
        message += PubMedService.formatPaperForDisplay(paper, index) + "\n\n";
      });
      message += `---\n输入 "下载 1" 可下载对应论文`;

      this.log("info", "Search complete", {
        count: result.papers.length,
        withPmc: result.papers.filter(p => p.hasFreeFullText).length,
      });

      return {
        success: true,
        message,
        data: { papers: result.papers },
      };
    } catch (error: any) {
      this.log("error", "Search failed", error.message);
      return {
        success: false,
        error: `搜索失败: ${error.message}`,
      };
    }
  }
}

export class PubMedDownloadTool extends BaseTool {
  name = "pubmed_download";
  description = "下载 PubMed 论文并导入到 Zotero。需要先搜索论文。如果有 PMC 全文会下载 PDF，否则只导入元数据。";
  parameters = [
    {
      name: "index",
      description: "要下载的论文编号（从 1 开始）",
      required: true,
    },
  ];

  async execute(
    params: ToolParams,
    context: ToolContext,
    callbacks: { onStatus?: StatusCallback; onStream?: StreamCallback },
  ): Promise<ToolResult> {
    const index = parseInt(params.index) - 1;
    const papers = PubMedSearchTool.getLastResults();

    if (papers.length === 0) {
      return {
        success: false,
        error: "请先搜索论文",
      };
    }

    if (index < 0 || index >= papers.length) {
      return {
        success: false,
        error: `无效的论文编号，请输入 1-${papers.length}`,
      };
    }

    const paper = papers[index];
    this.log("info", "Downloading", { pmid: paper.pmid, title: paper.title });
    callbacks.onStatus?.(`📥 正在下载: ${paper.title.substring(0, 40)}...`);

    try {
      const { item, hasFullText } = await PubMedService.downloadAndImport(paper);

      if (item) {
        this.log("info", "Download success", { itemId: item.id, hasFullText });
        const statusEmoji = hasFullText ? "✅" : "⚠️";
        const statusText = hasFullText ? "已下载PDF" : "仅元数据，无免费全文";
        return {
          success: true,
          message: `${statusEmoji} 下载成功!\nPMID:${paper.pmid} - ${paper.title}\n${statusText}\n已添加到 Zotero`,
          data: { item, paper, hasFullText },
        };
      } else {
        return {
          success: false,
          error: "下载失败，请重试",
        };
      }
    } catch (error: any) {
      this.log("error", "Download failed", error.message);
      return {
        success: false,
        error: `下载失败: ${error.message}`,
      };
    }
  }
}

export class PubMedBatchDownloadTool extends BaseTool {
  name = "pubmed_download_batch";
  description =
    "批量下载多篇 PubMed 论文。当用户要下载多篇论文时，优先使用此工具而不是多次调用 pubmed_download。";
  parameters = [
    {
      name: "indices",
      description: "要下载的论文编号列表，用逗号分隔（如 '1,2,3'）",
      required: true,
    },
  ];

  async execute(
    params: ToolParams,
    context: ToolContext,
    callbacks: { onStatus?: StatusCallback; onStream?: StreamCallback },
  ): Promise<ToolResult> {
    const papers = PubMedSearchTool.getLastResults();

    if (papers.length === 0) {
      return {
        success: false,
        error: "请先搜索论文",
      };
    }

    // Parse indices: "1,2,3" or "1, 2, 3"
    const indicesStr = String(params.indices || "");
    const indices = indicesStr
      .split(",")
      .map((s) => parseInt(s.trim()) - 1)
      .filter((i) => !isNaN(i) && i >= 0 && i < papers.length);

    if (indices.length === 0) {
      return {
        success: false,
        error: `无效的论文编号，请输入 1-${papers.length} 的数字，用逗号分隔`,
      };
    }

    this.log("info", "Batch downloading", { indices: indices.map((i) => i + 1) });

    const results: Array<{
      success: boolean;
      title: string;
      pmid: string;
      hasFullText: boolean;
      error?: string;
    }> = [];

    for (let i = 0; i < indices.length; i++) {
      const index = indices[i];
      const paper = papers[index];
      callbacks.onStatus?.(`📥 下载中 (${i + 1}/${indices.length}): ${paper.title.substring(0, 30)}...`);

      try {
        const { item, hasFullText } = await PubMedService.downloadAndImport(paper);
        if (item) {
          this.log("info", "Download success", { itemId: item.id, hasFullText });
          results.push({ success: true, title: paper.title, pmid: paper.pmid, hasFullText });
        } else {
          results.push({ success: false, title: paper.title, pmid: paper.pmid, hasFullText: false, error: "下载失败" });
        }
      } catch (error: any) {
        this.log("error", "Download failed", error.message);
        results.push({ success: false, title: paper.title, pmid: paper.pmid, hasFullText: false, error: error.message });
      }
    }

    const successCount = results.filter((r) => r.success).length;
    const withPdfCount = results.filter((r) => r.success && r.hasFullText).length;
    const summary = results
      .map((r, i) => {
        const emoji = r.success ? (r.hasFullText ? "✅" : "⚠️") : "❌";
        const suffix = r.success && !r.hasFullText ? " (仅元数据)" : "";
        return `${i + 1}. ${emoji} PMID:${r.pmid} - ${r.title.substring(0, 35)}${r.title.length > 35 ? "..." : ""}${suffix}`;
      })
      .join("\n");

    return {
      success: successCount > 0,
      message: `已完成 ${successCount}/${indices.length} 篇论文的下载（${withPdfCount} 篇有全文PDF），均已添加到你的Zotero库中：\n${summary}`,
      data: { results },
    };
  }
}
