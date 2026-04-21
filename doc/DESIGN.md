# Zotero Agent Design Philosophy

## Context Proximity (上下文亲近度)

When resolving which paper the user is referring to, we follow a "proximity-first" principle:

```
Library (全部)  →  Selected Items (明确指向)  →  Chat History (刚刚交互)
    远                                                     近
    模糊                                                   清晰
```

### Priority Order (Near to Far)

1. **Chat History** - Most recent, clearest intent
   - Papers just downloaded or discussed in conversation
   - Use `arxiv_id` or `pmid` parameter to precisely locate
   - Example: User asks "summarize this paper" right after downloading

2. **Selected Items** - Explicit user selection
   - User actively selected in Zotero UI
   - Clear intent, no ambiguity
   - This is Zotero's design philosophy: selection expresses intent

3. **Library Search** - Largest scope, may have ambiguity
   - Search by title, author, etc.
   - May return multiple matches
   - Should prompt user to select if ambiguous

### Why This Design?

- **Avoid redundant operations**: Don't re-download papers that are already in library or just downloaded
- **Respect user intent**: The closer the context, the clearer the user's intent
- **Reduce errors**: Searching library may return wrong paper with similar title
- **Better UX**: No need to manually select papers that were just mentioned in conversation

### Implementation

In `GetPaperContentTool`:
- `arxiv_id` parameter: Look up by arXiv ID (from chat history)
- `pmid` parameter: Look up by PubMed ID (from chat history)
- `selectedText`: Check if user selected text in PDF
- `selectedItems`: Use explicitly selected papers
- No context: Ask user to select or provide identifier

```typescript
// Priority 0a: arxiv_id from chat history (most specific)
if (arxivId) {
  const item = await this.findByArxivId(arxivId);
  if (item) return this.extractSinglePaper(item);
}

// Priority 0b: pmid from chat history
if (pmid) {
  const item = await this.findByPmid(pmid);
  if (item) return this.extractSinglePaper(item);
}

// Priority 1: Selected text in PDF
if (selectedText) { ... }

// Priority 2: Multiple selected papers
if (selectedItems.length > 1) { ... }

// Priority 3: Single selected paper
if (selectedItems.length === 1) { ... }
```

---

## Paper Sources Architecture

### Supported Sources

| Source | Search Tool | Download Tool | ID Field |
|--------|-------------|---------------|----------|
| arXiv | `arxiv_search` | `arxiv_download[_batch]` | `archiveID` |
| PubMed | `pubmed_search` | `pubmed_download[_batch]` | `extra` (PMID) |

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        ToolUseRegistry                          │
│  - Register tools, tool definitions (OpenAI format)             │
│  - Build system prompt, LLM function calling loop               │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Tools Layer                              │
│  ArxivTools.ts          │         PubMedTools.ts                │
│  - Search, Download     │         - Search, Download            │
│  - Batch Download       │         - Batch Download              │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Service Layer                             │
│  ArxivService.ts        │         PubMedService.ts              │
│  - API calls            │         - E-utilities API             │
│  - Parse responses      │         - PMC availability check      │
│  - Import to Zotero     │         - Import to Zotero            │
└─────────────────────────────────────────────────────────────────┘
```

### PubMed Specifics

- **Rate Limit**: 3 req/sec without API key. First search shows reminder.
- **PDF Availability**: Only PMC papers have free PDF. Others import metadata only.
- **Download Message Format**: `PMID:12345678 - Title` (for context proximity lookup)

---

## Streaming + Tool Use Architecture

### Flow
1. User input + tools → LLM decides to call tool or respond directly
2. Content streams in real-time, tool_calls accumulate
3. If tool called → execute ALL tool calls, get results
4. Tool results → LLM generates final response (streaming)

### Status Display Rules
- New status overwrites previous if no response between them
- After response text, create new status block
- Tool calls show as collapsible "Thinking" blocks (like DUCC)

### Batch Operations
- Prefer `arxiv_download_batch` / `pubmed_download_batch` over multiple single calls
- Process ALL tool_calls in a single LLM response, not just the first one

---

## Download Message Format

To enable context proximity lookup, download messages must include paper IDs:

```
# arXiv
✅ 下载成功!
arXiv:2211.15444 - Paper Title
已添加到 Zotero

# PubMed
✅ 下载成功!
PMID:12345678 - Paper Title
已下载PDF (或: 仅元数据，无免费全文)
已添加到 Zotero
```

This allows LLM to extract IDs from chat history and call `get_paper_content(arxiv_id="xxx")` or `get_paper_content(pmid="xxx")`.

---

## Selected Text Handling (选中文本处理)

### Design Decision: Ephemeral, Not Persisted

Selected text in PDF is **ephemeral** — only valid for the current turn, not stored in chat history.

```
User selects text → Tool fetches it → LLM responds → Selection cleared = text gone
```

### Why Not Persist Selected Text?

1. **Tool results already enter conversation**: LLM's response naturally summarizes/quotes the key points
2. **Avoid context bloat**: Users may select many different passages; storing all would inflate context
3. **Matches user mental model**: Selection is a temporary action; deselecting = no longer focusing on it
4. **Industry practice**: Cursor, Copilot, etc. treat selections as ephemeral

### How It Works

1. **System prompt informs LLM** (without content):
   ```typescript
   contextInfo += `\nPDF 中有选中文本 (${context.selectedText.length} 字符)`;
   ```

2. **LLM decides to call tool** → `get_paper_content`

3. **Tool returns selected text** → LLM generates response based on it

4. **Response preserves "essence"**: The important parts are captured in LLM's reply, which stays in chat history

### If User Wants to Re-discuss

- Re-select the text, or
- Say "the passage we just discussed..." (LLM can reference its previous response)
