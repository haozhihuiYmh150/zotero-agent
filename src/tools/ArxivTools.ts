/**
 * ArXiv Search Tool
 */

import { BaseTool, ToolContext, ToolParams, ToolResult, StatusCallback, StreamCallback } from "./BaseTool";
import { ArxivService, ArxivPaper } from "../services/ArxivService";

export class ArxivSearchTool extends BaseTool {
  name = "arxiv_search";
  description = "在 arXiv 上搜索学术论文。当用户想要查找论文、搜索文献时使用。";
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
  private static lastResults: ArxivPaper[] = [];

  static getLastResults(): ArxivPaper[] {
    return this.lastResults;
  }

  async execute(
    params: ToolParams,
    context: ToolContext,
    callbacks: { onStatus?: StatusCallback; onStream?: StreamCallback }
  ): Promise<ToolResult> {
    const { keywords, maxResults = 5 } = params;

    if (!keywords) {
      return {
        success: false,
        error: "请提供搜索关键词",
      };
    }

    this.log("info", "Searching", { keywords, maxResults });
    callbacks.onStatus?.(`🔍 正在搜索: ${keywords}`);

    try {
      const result = await ArxivService.search(keywords, maxResults);
      ArxivSearchTool.lastResults = result.papers;

      if (result.papers.length === 0) {
        return {
          success: true,
          message: `未找到与 "${keywords}" 相关的论文`,
          data: { papers: [] },
        };
      }

      // Format results
      let message = `**arXiv 搜索结果** (${keywords})\n\n`;
      result.papers.forEach((paper, index) => {
        message += ArxivService.formatPaperForDisplay(paper, index) + "\n\n";
      });
      message += `---\n输入 "下载 1" 可下载对应论文`;

      this.log("info", "Search complete", { count: result.papers.length });

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

/**
 * ArXiv Download Tool
 */
export class ArxivDownloadTool extends BaseTool {
  name = "arxiv_download";
  description = "下载 arXiv 论文并导入到 Zotero。需要先搜索论文。";
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
    callbacks: { onStatus?: StatusCallback; onStream?: StreamCallback }
  ): Promise<ToolResult> {
    const index = parseInt(params.index) - 1;
    const papers = ArxivSearchTool.getLastResults();

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
    this.log("info", "Downloading", { id: paper.id, title: paper.title });
    callbacks.onStatus?.(`📥 正在下载: ${paper.title.substring(0, 40)}...`);

    try {
      const item = await ArxivService.downloadAndImport(paper);

      if (item) {
        this.log("info", "Download success", { itemId: item.id });
        return {
          success: true,
          message: `✅ 下载成功!\n${paper.title}\n已添加到 Zotero`,
          data: { item, paper },
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
