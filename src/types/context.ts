/**
 * Context types for conversation history
 *
 * Key design: Store references (not full content) in chat history.
 * Paper content is fetched on-demand from Zotero when needed.
 */

/**
 * Paper reference - lightweight identifier for a paper
 * Used in chat history to track which papers were discussed
 */
export interface PaperRef {
  /** Zotero item key (unique identifier) */
  key: string;
  /** Zotero library ID */
  libraryID: number;
  /** Paper title (for display and LLM context) */
  title: string;
  /** Authors (optional, for display) */
  authors?: string;
  /** Year (optional, for display) */
  year?: string;
}

/**
 * Message context - environment snapshot when a message was sent
 * Stored alongside each chat message
 */
export interface MessageContext {
  /** Timestamp when message was sent */
  timestamp: number;
  /** Papers that were selected when this message was sent */
  papers?: PaperRef[];
  /** Text that was selected in PDF when this message was sent */
  selectedText?: string;
  /** Location of selected text (for reference) */
  selectedTextLocation?: {
    paperKey: string;
    page?: number;
  };
}

/**
 * Chat message with context
 */
export interface ChatMessage {
  /** Message role */
  role: "user" | "assistant";
  /** Message content */
  content: string;
  /** Whether this is a user message */
  isUser: boolean;
  /** Unique message ID */
  id: string;
  /** Context snapshot (optional, mainly for user messages) */
  context?: MessageContext;
}

/**
 * Helper to create a PaperRef from a Zotero item
 */
export function createPaperRef(item: Zotero.Item): PaperRef {
  const creators = item.getCreators();
  let authors = "";
  if (creators.length > 0) {
    const firstAuthor = creators[0] as any;
    authors = firstAuthor.lastName || firstAuthor.name || firstAuthor.firstName || "";
    if (creators.length > 1) {
      authors += " et al.";
    }
  }

  return {
    key: item.key,
    libraryID: item.libraryID,
    title: (item.getField("title") as string) || "Untitled",
    authors: authors || undefined,
    year: (item.getField("year") as string) || undefined,
  };
}

/**
 * Helper to get paper content from a PaperRef
 * Fetches the full item from Zotero
 */
export async function getPaperByRef(ref: PaperRef): Promise<Zotero.Item | null> {
  try {
    const item = await Zotero.Items.getByLibraryAndKeyAsync(ref.libraryID, ref.key);
    return item || null;
  } catch (error) {
    console.error(`Failed to get paper by ref: ${ref.key}`, error);
    return null;
  }
}

/**
 * Build a brief description of papers for LLM context
 * Used when reconstructing context from history
 */
export function buildPapersDescription(papers: PaperRef[]): string {
  if (papers.length === 0) return "";

  if (papers.length === 1) {
    const p = papers[0];
    let desc = `论文: "${p.title}"`;
    if (p.authors) desc += ` (${p.authors}`;
    if (p.year) desc += `, ${p.year}`;
    if (p.authors) desc += ")";
    return desc;
  }

  return `${papers.length} 篇论文: ${papers.map(p => `"${p.title}"`).join(", ")}`;
}
