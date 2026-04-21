/**
 * PDF Service - Extract PDF text
 */

import { Logger } from "../utils/logger";

export class PDFService {
  /**
   * Get PDF attachment from selected Zotero item
   */
  static async getPDFAttachment(
    item: Zotero.Item,
  ): Promise<Zotero.Item | null> {
    Logger.debug("PDF", "getPDFAttachment called", {
      itemId: item.id,
      itemType: item.itemType,
      isAttachment: item.isAttachment(),
      isRegularItem: item.isRegularItem(),
    });

    if (
      item.isAttachment() &&
      item.attachmentContentType === "application/pdf"
    ) {
      Logger.debug("PDF", "Item is already a PDF attachment");
      return item;
    }

    if (item.isRegularItem()) {
      const attachmentIDs = item.getAttachments();
      Logger.debug("PDF", "Checking attachments", {
        attachmentCount: attachmentIDs.length,
        attachmentIDs,
      });

      for (const id of attachmentIDs) {
        const attachment = await Zotero.Items.getAsync(id);
        Logger.debug("PDF", "Checking attachment", {
          id,
          contentType: attachment?.attachmentContentType,
          linkMode: attachment?.attachmentLinkMode,
        });
        if (
          attachment &&
          attachment.attachmentContentType === "application/pdf"
        ) {
          Logger.info("PDF", "Found PDF attachment", { attachmentId: id });
          return attachment as Zotero.Item;
        }
      }
    }

    Logger.warn("PDF", "No PDF attachment found");
    return null;
  }

  /**
   * Get selected text from PDF reader
   */
  static getSelectedText(): string | null {
    try {
      const ZoteroReader = Zotero.Reader as any;

      // Get current active reader
      const reader = ZoteroReader.getByTabID(
        (Zotero.getActiveZoteroPane() as any)?.tabID,
      );

      if (!reader) {
        // Try to get any open reader
        const readers = ZoteroReader._readers;
        Logger.debug("PDF", "No active reader, checking all readers", {
          count: readers?.length,
        });
        if (readers && readers.length > 0) {
          const activeReader = readers[readers.length - 1];
          if (activeReader?._internalReader?._primaryView?._iframeWindow) {
            const win = activeReader._internalReader._primaryView._iframeWindow;
            const selection = win.getSelection?.();
            if (selection && selection.toString().trim()) {
              const text = selection.toString().trim();
              Logger.info("PDF", "Got selected text from reader", {
                length: text.length,
              });
              return text;
            }
          }
        }
        return null;
      }

      // Get selected text from reader
      if (reader._internalReader?._primaryView?._iframeWindow) {
        const win = reader._internalReader._primaryView._iframeWindow;
        const selection = win.getSelection?.();
        if (selection && selection.toString().trim()) {
          const text = selection.toString().trim();
          Logger.info("PDF", "Got selected text", { length: text.length });
          return text;
        }
      }

      Logger.debug("PDF", "No text selected");
      return null;
    } catch (e) {
      Logger.error("PDF", "Failed to get selected text", e);
      return null;
    }
  }

  /**
   * Extract full text from PDF (using Zotero's built-in full-text indexing)
   */
  static async extractFullText(pdfItem: Zotero.Item): Promise<string> {
    Logger.info("PDF", "extractFullText called", {
      itemId: pdfItem.id,
      itemType: pdfItem.itemType,
      isAttachment: pdfItem.isAttachment(),
      contentType: pdfItem.attachmentContentType,
    });

    try {
      // Check if PDF file exists
      const filePath = await pdfItem.getFilePathAsync();
      Logger.debug("PDF", "File path", { filePath: filePath || "null" });

      if (!filePath) {
        throw new Error("PDF file path is null - file may not be downloaded");
      }

      const Fulltext = Zotero.Fulltext as any;

      // Method 1: Read full text from cache file
      try {
        const cacheFile = Fulltext.getItemCacheFile(pdfItem);
        Logger.debug("PDF", "Cache file", { path: cacheFile?.path });

        if (cacheFile && (await cacheFile.exists())) {
          const content = await Zotero.File.getContentsAsync(cacheFile.path);
          if (content && typeof content === "string" && content.length > 0) {
            Logger.info("PDF", "Got content from cache file", {
              length: content.length,
            });
            return content;
          }
        }
      } catch (cacheErr: any) {
        Logger.debug("PDF", "Cache file read failed", {
          error: cacheErr.message,
        });
      }

      // Check index status
      const indexState = await Fulltext.getIndexedState(pdfItem);
      Logger.info("PDF", "Index state", {
        indexState,
        states: {
          UNAVAILABLE: Fulltext.INDEX_STATE_UNAVAILABLE,
          UNINDEXED: Fulltext.INDEX_STATE_UNINDEXED,
          PARTIAL: Fulltext.INDEX_STATE_PARTIAL,
          INDEXED: Fulltext.INDEX_STATE_INDEXED,
        },
      });

      // If not indexed, try to trigger indexing
      if (indexState !== Fulltext.INDEX_STATE_INDEXED) {
        Logger.info("PDF", "Triggering indexItems...", { itemId: pdfItem.id });
        await Fulltext.indexItems([pdfItem.id], { complete: true });

        // Wait for indexing to complete
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Try to read cache file again
        try {
          const cacheFile = Fulltext.getItemCacheFile(pdfItem);
          if (cacheFile && (await cacheFile.exists())) {
            const content = await Zotero.File.getContentsAsync(cacheFile.path);
            if (content && typeof content === "string" && content.length > 0) {
              Logger.info("PDF", "Got content after indexing", {
                length: content.length,
              });
              return content;
            }
          }
        } catch (cacheErr: any) {
          Logger.debug("PDF", "Post-index cache read failed", {
            error: cacheErr.message,
          });
        }
      }

      const newIndexState = await Fulltext.getIndexedState(pdfItem);
      throw new Error(
        `Unable to extract PDF text. Index state: ${newIndexState}. Please ensure the PDF has been indexed by Zotero.`,
      );
    } catch (error: any) {
      Logger.error("PDF", "extractFullText error", {
        message: error.message,
        stack: error.stack?.substring(0, 500),
      });
      throw error;
    }
  }

  /**
   * Get PDF metadata (title, authors, etc.)
   */
  static getItemMetadata(item: Zotero.Item): {
    title: string;
    authors: string;
    abstract: string;
    year: string;
  } {
    const parentItemID = item.isAttachment() ? item.parentItemID : null;
    const parentItem = parentItemID ? Zotero.Items.get(parentItemID) : item;

    return {
      title: (parentItem?.getField("title") as string) || "Unknown",
      authors:
        parentItem
          ?.getCreators()
          ?.map((c: any) => `${c.firstName || ""} ${c.lastName || ""}`.trim())
          .join(", ") || "Unknown",
      abstract: (parentItem?.getField("abstractNote") as string) || "",
      year:
        ((parentItem?.getField("date") as string) || "").substring(0, 4) ||
        "Unknown",
    };
  }

  /**
   * Truncate text to first N characters (for LLM input limits)
   */
  static truncateText(text: string, maxLength: number = 8000): string {
    if (text.length <= maxLength) {
      return text;
    }
    return text.substring(0, maxLength) + "\n\n[... content truncated ...]";
  }
}
