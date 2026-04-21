/**
 * PubMed Service - Search and download PubMed papers via E-utilities API
 *
 * API Docs: https://www.ncbi.nlm.nih.gov/books/NBK25499/
 * Rate limit: 3 requests/sec without API key, 10 requests/sec with API key
 */

import { Logger } from "../utils/logger";

export interface PubMedPaper {
  pmid: string;           // PubMed ID, e.g., "12345678"
  title: string;
  authors: string[];
  abstract: string;
  journal: string;
  pubDate: string;        // e.g., "2023 Jan 15"
  doi?: string;
  pmcid?: string;         // PMC ID if available (means free full text)
  hasFreeFullText: boolean;
  pdfUrl?: string;        // PMC PDF URL if available
  pubmedUrl: string;
}

export interface PubMedSearchResult {
  papers: PubMedPaper[];
  totalResults: number;
  query: string;
}

export class PubMedService {
  private static readonly ESEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi";
  private static readonly EFETCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi";
  private static readonly ELINK_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/elink.fcgi";
  private static readonly TIMEOUT_MS = 30000;
  private static readonly REQUEST_DELAY_MS = 350; // ~3 requests/sec to be safe

  // Track if we've shown the rate limit reminder this session
  private static hasShownRateLimitReminder = false;

  /**
   * Check if we should show rate limit reminder (first time this session)
   */
  static shouldShowRateLimitReminder(): boolean {
    if (!this.hasShownRateLimitReminder) {
      this.hasShownRateLimitReminder = true;
      return true;
    }
    return false;
  }

  /**
   * Search PubMed papers
   */
  static async search(
    query: string,
    maxResults: number = 5,
  ): Promise<PubMedSearchResult> {
    Logger.info("PubMed", "=== SEARCH START ===", { query, maxResults });

    try {
      // Step 1: ESearch - get PMIDs
      Logger.info("PubMed", "Step 1: ESearch...");
      const pmids = await this.esearch(query, maxResults);
      if (pmids.length === 0) {
        Logger.info("PubMed", "=== SEARCH END (no results) ===");
        return { papers: [], totalResults: 0, query };
      }

      // Step 2: EFetch - get paper details
      Logger.info("PubMed", "Step 2: EFetch...", { pmidCount: pmids.length });
      const papers = await this.efetch(pmids);
      Logger.info("PubMed", "EFetch parsed", {
        paperCount: papers.length,
        titles: papers.map(p => p.title.substring(0, 30) + "..."),
      });

      // Step 3: Check PMC availability for each paper
      Logger.info("PubMed", "Step 3: Check PMC availability...");
      await this.checkPmcAvailability(papers);

      Logger.info("PubMed", "=== SEARCH END ===", {
        resultsCount: papers.length,
        withPmc: papers.filter(p => p.hasFreeFullText).length,
        pmcPapers: papers.filter(p => p.hasFreeFullText).map(p => p.pmid),
      });

      return { papers, totalResults: papers.length, query };
    } catch (error: any) {
      Logger.error("PubMed", "=== SEARCH FAILED ===", error.message);
      if (error.message?.includes("timeout")) {
        throw new Error("PubMed 请求超时，请稍后重试");
      }
      throw new Error(`PubMed 搜索失败: ${error.message}`);
    }
  }

  /**
   * ESearch - search and return PMID list
   */
  private static async esearch(query: string, maxResults: number): Promise<string[]> {
    const params = new URLSearchParams({
      db: "pubmed",
      term: query,
      retmax: String(maxResults),
      retmode: "json",
      sort: "relevance",
    });

    const url = `${this.ESEARCH_URL}?${params}`;
    Logger.debug("PubMed", "ESearch request", { url });

    const response = await this.makeRequest(url);
    const data = JSON.parse(response);

    const pmids = data?.esearchresult?.idlist || [];
    Logger.debug("PubMed", "ESearch result", { count: pmids.length, pmids });

    return pmids;
  }

  /**
   * EFetch - fetch paper details by PMIDs
   */
  private static async efetch(pmids: string[]): Promise<PubMedPaper[]> {
    // Small delay between requests
    await this.delay(this.REQUEST_DELAY_MS);

    const params = new URLSearchParams({
      db: "pubmed",
      id: pmids.join(","),
      retmode: "xml",
      rettype: "abstract",
    });

    const url = `${this.EFETCH_URL}?${params}`;
    Logger.debug("PubMed", "EFetch request", { url, pmidCount: pmids.length });

    const response = await this.makeRequest(url);
    return this.parseEfetchXml(response);
  }

  /**
   * Check PMC availability for papers (batch)
   */
  private static async checkPmcAvailability(papers: PubMedPaper[]): Promise<void> {
    if (papers.length === 0) return;

    await this.delay(this.REQUEST_DELAY_MS);

    const pmids = papers.map(p => p.pmid);
    const params = new URLSearchParams({
      dbfrom: "pubmed",
      db: "pmc",
      id: pmids.join(","),
      retmode: "json",
    });

    const url = `${this.ELINK_URL}?${params}`;
    Logger.debug("PubMed", "ELink request (PMC check)", { url });

    try {
      const response = await this.makeRequest(url);
      const data = JSON.parse(response);

      // Parse linksets to find PMC IDs
      const linksets = data?.linksets || [];
      for (const linkset of linksets) {
        const pmid = linkset.ids?.[0];
        const pmcLinks = linkset.linksetdbs?.find((db: any) => db.dbto === "pmc");
        if (pmid && pmcLinks?.links?.length > 0) {
          const pmcid = `PMC${pmcLinks.links[0]}`;
          const paper = papers.find(p => p.pmid === String(pmid));
          if (paper) {
            paper.pmcid = pmcid;
            paper.hasFreeFullText = true;
            paper.pdfUrl = `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcid}/pdf/`;
          }
        }
      }
    } catch (error: any) {
      Logger.warn("PubMed", "PMC check failed (non-critical)", error.message);
      // Don't throw - PMC check is optional
    }
  }

  /**
   * Parse EFetch XML response
   */
  private static parseEfetchXml(xml: string): PubMedPaper[] {
    const papers: PubMedPaper[] = [];

    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(xml, "text/xml");
      const articles = doc.querySelectorAll("PubmedArticle");

      articles.forEach((article: Element) => {
        const pmid = this.getTextContent(article, "PMID");
        const title = this.getTextContent(article, "ArticleTitle") || "Untitled";

        // Authors
        const authors: string[] = [];
        const authorElements = article.querySelectorAll("Author");
        authorElements.forEach((author: Element) => {
          const lastName = this.getTextContent(author, "LastName");
          const foreName = this.getTextContent(author, "ForeName");
          if (lastName) {
            authors.push(foreName ? `${foreName} ${lastName}` : lastName);
          }
        });

        // Abstract
        const abstractTexts: string[] = [];
        const abstractElements = article.querySelectorAll("AbstractText");
        abstractElements.forEach((el: Element) => {
          const label = el.getAttribute("Label");
          const text = el.textContent?.trim() || "";
          if (text) {
            abstractTexts.push(label ? `${label}: ${text}` : text);
          }
        });
        const abstract = abstractTexts.join(" ");

        // Journal
        const journal = this.getTextContent(article, "Journal Title") ||
                       this.getTextContent(article, "ISOAbbreviation") ||
                       this.getTextContent(article, "MedlineTA") || "";

        // Publication date
        const pubDateEl = article.querySelector("PubDate");
        let pubDate = "";
        if (pubDateEl) {
          const year = this.getTextContent(pubDateEl, "Year");
          const month = this.getTextContent(pubDateEl, "Month");
          const day = this.getTextContent(pubDateEl, "Day");
          pubDate = [year, month, day].filter(Boolean).join(" ");
        }

        // DOI
        const articleIds = article.querySelectorAll("ArticleId");
        let doi: string | undefined;
        articleIds.forEach((idEl: Element) => {
          if (idEl.getAttribute("IdType") === "doi") {
            doi = idEl.textContent?.trim();
          }
        });

        const paper: PubMedPaper = {
          pmid,
          title: title.replace(/\s+/g, " ").trim(),
          authors,
          abstract,
          journal,
          pubDate,
          doi,
          hasFreeFullText: false,
          pubmedUrl: `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`,
        };

        papers.push(paper);
      });
    } catch (e: any) {
      Logger.error("PubMed", "Parse error", e.message);
    }

    return papers;
  }

  private static getTextContent(parent: Element, tagName: string): string {
    const el = parent.querySelector(tagName);
    return el?.textContent?.trim() || "";
  }

  /**
   * Make HTTP request
   */
  private static makeRequest(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("GET", url, true);
      xhr.setRequestHeader("User-Agent", "ZoteroAgent/1.0 (mailto:zotero-agent@example.com)");

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(xhr.responseText || "");
        } else if (xhr.status === 429) {
          reject(new Error("请求频率过高，请稍后重试"));
        } else {
          reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
        }
      };

      xhr.onerror = () => reject(new Error("Network error"));
      xhr.ontimeout = () => reject(new Error("Request timeout"));
      xhr.timeout = this.TIMEOUT_MS;
      xhr.send();
    });
  }

  private static delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Download paper and import to Zotero
   * Returns: { item, hasFullText }
   */
  static async downloadAndImport(
    paper: PubMedPaper,
    collectionId?: number,
  ): Promise<{ item: Zotero.Item; hasFullText: boolean }> {
    Logger.info("PubMed", "=== DOWNLOAD START ===", {
      pmid: paper.pmid,
      title: paper.title.substring(0, 50),
      doi: paper.doi,
      pmcid: paper.pmcid,
      hasPmcPdf: paper.hasFreeFullText,
    });

    try {
      // Create Zotero item - use journalArticle type
      Logger.info("PubMed", "Creating Zotero item...");
      const item = new Zotero.Item("journalArticle");
      item.setField("title", paper.title);
      item.setField("abstractNote", paper.abstract);
      item.setField("publicationTitle", paper.journal);
      item.setField("url", paper.pubmedUrl);

      // Parse and set date
      if (paper.pubDate) {
        // Try to parse "2023 Jan 15" format
        const dateMatch = paper.pubDate.match(/(\d{4})/);
        if (dateMatch) {
          item.setField("date", paper.pubDate);
        }
      }

      if (paper.doi) {
        item.setField("DOI", paper.doi);
      }

      // Store PMID in extra field for later lookup
      let extra = `PMID: ${paper.pmid}`;
      if (paper.pmcid) {
        extra += `\nPMCID: ${paper.pmcid}`;
      }
      item.setField("extra", extra);

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
      Logger.info("PubMed", "Authors added", { count: paper.authors.length });

      // Save item
      const libraryID = Zotero.Libraries.userLibraryID;
      item.libraryID = libraryID;

      if (collectionId) {
        item.addToCollection(collectionId);
        Logger.info("PubMed", "Added to collection", { collectionId });
      }

      await item.saveTx();
      Logger.info("PubMed", "Item created", { itemId: item.id });

      // Try to download PDF - two strategies with fallback
      let hasFullText = false;

      // Strategy 1: Zotero's built-in finder (Unpaywall, open access repositories)
      try {
        Logger.info("PubMed", "Trying Zotero addAvailableFile...");
        const attachment = await Zotero.Attachments.addAvailableFile(item);
        if (attachment) {
          hasFullText = true;
          Logger.info("PubMed", "PDF attached via Zotero", { attachmentId: attachment.id });
        }
      } catch (e: any) {
        Logger.warn("PubMed", "addAvailableFile failed", e.message);
      }

      // Strategy 2: Direct PMC URL (fallback, may fail due to anti-bot protection)
      if (!hasFullText && paper.pdfUrl && paper.pmcid) {
        try {
          Logger.info("PubMed", "Trying PMC direct URL...", paper.pdfUrl);
          const attachment = await Zotero.Attachments.importFromURL({
            libraryID,
            url: paper.pdfUrl,
            parentItemID: item.id,
            contentType: "application/pdf",
            title: `${paper.pmcid}.pdf`,
          });
          if (attachment) {
            hasFullText = true;
            Logger.info("PubMed", "PDF attached via PMC", { attachmentId: attachment.id });
          }
        } catch (e: any) {
          Logger.warn("PubMed", "PMC download failed", e.message);
        }
      }

      if (!hasFullText) {
        Logger.info("PubMed", "No PDF available for this paper");
      }

      Logger.info("PubMed", "=== DOWNLOAD END ===", {
        pmid: paper.pmid,
        itemId: item.id,
        hasFullText,
      });

      return { item, hasFullText };
    } catch (error: any) {
      Logger.error("PubMed", "=== DOWNLOAD FAILED ===", error.message);
      throw error;
    }
  }

  /**
   * Format paper info for display
   */
  static formatPaperForDisplay(paper: PubMedPaper, index: number): string {
    const authors =
      paper.authors.slice(0, 3).join(", ") +
      (paper.authors.length > 3 ? " et al." : "");
    const year = paper.pubDate?.match(/\d{4}/)?.[0] || "";
    const abstractShort =
      paper.abstract.length > 150
        ? paper.abstract.substring(0, 150) + "..."
        : paper.abstract || "(无摘要)";
    const pmcTag = paper.hasFreeFullText ? " 🆓" : "";

    return `**[${index + 1}] ${paper.title}**${pmcTag}
作者: ${authors}${year ? ` (${year})` : ""}
PMID: ${paper.pmid}${paper.pmcid ? ` | ${paper.pmcid}` : ""}
期刊: ${paper.journal || "未知"}
摘要: ${abstractShort}`;
  }
}
