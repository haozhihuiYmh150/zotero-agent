/**
 * ArXiv Service - Search and download arXiv papers
 */

import { Logger } from "../utils/logger";

export interface ArxivPaper {
  id: string;           // arXiv ID, e.g., "2301.00001"
  title: string;
  authors: string[];
  abstract: string;
  published: string;    // ISO date
  updated: string;
  categories: string[];
  pdfUrl: string;
  arxivUrl: string;
}

export interface ArxivSearchResult {
  papers: ArxivPaper[];
  totalResults: number;
  query: string;
}

export class ArxivService {
  private static readonly API_BASE = "https://export.arxiv.org/api/query";
  // arXiv official requires 3 second interval between consecutive requests
  private static readonly REQUEST_DELAY_MS = 3000;
  // Set timeout to 60 seconds (network access may be slow in some regions)
  private static readonly TIMEOUT_MS = 60000;

  /**
   * Search arXiv papers
   */
  static async search(query: string, maxResults: number = 5): Promise<ArxivSearchResult> {
    Logger.info("Arxiv", "Searching", { query, maxResults, timeout: this.TIMEOUT_MS });

    try {
      // Build search URL
      const searchQuery = encodeURIComponent(query);
      const url = `${this.API_BASE}?search_query=all:${searchQuery}&start=0&max_results=${maxResults}&sortBy=relevance&sortOrder=descending`;

      Logger.debug("Arxiv", "Request URL", url);

      const response = await Zotero.HTTP.request("GET", url, {
        responseType: "text",
        timeout: this.TIMEOUT_MS,
      });

      if (response.status !== 200) {
        throw new Error(`arXiv API returned status ${response.status}`);
      }

      const papers = this.parseAtomFeed(response.response as string);
      Logger.info("Arxiv", "Search complete", { resultsCount: papers.length });

      return {
        papers,
        totalResults: papers.length,
        query,
      };
    } catch (error: any) {
      Logger.error("Arxiv", "Search failed", error.message);
      // Provide more user-friendly error message
      if (error.message?.includes("timeout") || error.message?.includes("timed out")) {
        throw new Error("arXiv request timed out. Network may be slow, please retry later or use a proxy");
      }
      throw error;
    }
  }

  /**
   * Generate search keywords from paper information
   */
  static generateSearchQuery(title: string, abstract?: string): string {
    // Extract keywords from title (remove common words)
    const stopWords = new Set([
      "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
      "of", "with", "by", "from", "as", "is", "was", "are", "were", "been",
      "be", "have", "has", "had", "do", "does", "did", "will", "would",
      "could", "should", "may", "might", "must", "shall", "can", "need",
      "using", "based", "through", "via", "into", "upon", "about", "between",
      "under", "over", "after", "before", "during", "without", "within",
    ]);

    const words = title
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter(word => word.length > 2 && !stopWords.has(word));

    // Take first 5 keywords
    const keywords = words.slice(0, 5);
    return keywords.join(" ");
  }

  /**
   * Parse arXiv Atom Feed
   */
  private static parseAtomFeed(xml: string): ArxivPaper[] {
    const papers: ArxivPaper[] = [];

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xml, "text/xml");
      const entries = doc.querySelectorAll("entry");

      entries.forEach((entry: Element) => {
        const id = this.getTextContent(entry, "id");
        const arxivId = id.replace("http://arxiv.org/abs/", "").replace(/v\d+$/, "");

        const authorElements = entry.querySelectorAll("author name");
        const categoryElements = entry.querySelectorAll("category");

        const authors: string[] = [];
        authorElements.forEach((el: Element) => authors.push(el.textContent?.trim() || ""));

        const categories: string[] = [];
        categoryElements.forEach((el: Element) => categories.push(el.getAttribute("term") || ""));

        const paper: ArxivPaper = {
          id: arxivId,
          title: this.getTextContent(entry, "title").replace(/\s+/g, " ").trim(),
          authors,
          abstract: this.getTextContent(entry, "summary").replace(/\s+/g, " ").trim(),
          published: this.getTextContent(entry, "published"),
          updated: this.getTextContent(entry, "updated"),
          categories,
          pdfUrl: `https://arxiv.org/pdf/${arxivId}.pdf`,
          arxivUrl: `https://arxiv.org/abs/${arxivId}`,
        };

        papers.push(paper);
      });
    } catch (e) {
      Logger.error("Arxiv", "Parse error", e);
    }

    return papers;
  }

  private static getTextContent(parent: Element, tagName: string): string {
    const el = parent.querySelector(tagName);
    return el?.textContent?.trim() || "";
  }

  /**
   * Download paper and import to Zotero
   */
  static async downloadAndImport(paper: ArxivPaper, collectionId?: number): Promise<Zotero.Item | null> {
    Logger.info("Arxiv", "Downloading paper", { id: paper.id, title: paper.title });

    try {
      // Create Zotero item - use preprint type (new in Zotero 7)
      const item = new Zotero.Item("preprint");
      item.setField("title", paper.title);
      item.setField("abstractNote", paper.abstract);
      item.setField("date", paper.published.substring(0, 10));
      item.setField("url", paper.arxivUrl);
      item.setField("DOI", `10.48550/arXiv.${paper.id}`);
      item.setField("repository", "arXiv");
      item.setField("archiveID", `arXiv:${paper.id}`);

      // Add authors
      for (const authorName of paper.authors) {
        const nameParts = authorName.split(" ");
        const lastName = nameParts.pop() || "";
        const firstName = nameParts.join(" ");
        item.setCreator(item.getCreators().length, {
          firstName,
          lastName,
          creatorType: "author",
        });
      }

      // Save item
      const libraryID = Zotero.Libraries.userLibraryID;
      item.libraryID = libraryID;

      if (collectionId) {
        item.addToCollection(collectionId);
      }

      await item.saveTx();
      Logger.info("Arxiv", "Item created", { itemId: item.id });

      // Download PDF
      Logger.info("Arxiv", "Downloading PDF", paper.pdfUrl);

      const attachment = await Zotero.Attachments.importFromURL({
        libraryID,
        url: paper.pdfUrl,
        parentItemID: item.id,
        contentType: "application/pdf",
        title: `${paper.id}.pdf`,
      });

      Logger.info("Arxiv", "PDF attached", { attachmentId: attachment?.id });

      return item;
    } catch (error: any) {
      Logger.error("Arxiv", "Download failed", error.message);
      throw error;
    }
  }

  /**
   * Format paper info for display
   */
  static formatPaperForDisplay(paper: ArxivPaper, index: number): string {
    const authors = paper.authors.slice(0, 3).join(", ") +
      (paper.authors.length > 3 ? " et al." : "");
    const year = paper.published.substring(0, 4);
    const abstractShort = paper.abstract.length > 150
      ? paper.abstract.substring(0, 150) + "..."
      : paper.abstract;

    return `**[${index + 1}] ${paper.title}**
作者: ${authors} (${year})
arXiv: ${paper.id}
摘要: ${abstractShort}`;
  }
}
