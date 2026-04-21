import { marked } from "marked";
import markedKatex from "marked-katex-extension";
import { getString, getLocaleID } from "../utils/locale";
import { LLMService } from "../services/LLMService";
import { PDFService } from "../services/PDFService";
import { ArxivService, ArxivPaper } from "../services/ArxivService";
import { getPref } from "../utils/prefs";
import { Logger } from "../utils/logger";

// Configure marked with KaTeX support
marked.use(
  markedKatex({
    throwOnError: false, // Don't throw on invalid LaTeX
    output: "html", // Output HTML (not MathML)
  }),
);
marked.use({
  breaks: true, // Convert \n to <br>
  gfm: true, // GitHub Flavored Markdown
});

/**
 * Render markdown to HTML
 * User messages: plain text (escape HTML)
 * Agent messages: render markdown
 */
function renderMarkdown(text: string, isUser: boolean): string {
  if (isUser) {
    // User messages: escape HTML and preserve whitespace
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\n/g, "<br/>");
  }
  // Agent messages: render markdown, then fix self-closing tags for XHTML compatibility
  const html = marked.parse(text) as string;
  return html
    .replace(/<br>/g, "<br/>")
    .replace(/<hr>/g, "<hr/>")
    .replace(/<img([^>]*)>/g, "<img$1/>");
}

/**
 * Get markdown content styles for Agent messages
 */
function getMarkdownStyles(): string {
  return `
    /* Markdown content styles */
    .markdown-content p { margin: 0 0 8px 0; }
    .markdown-content p:last-child { margin-bottom: 0; }
    .markdown-content code {
      background: var(--fill-quinary, #f5f5f5);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: monospace;
      font-size: 12px;
    }
    .markdown-content pre {
      background: var(--fill-quinary, #f5f5f5);
      padding: 10px;
      border-radius: 6px;
      overflow-x: auto;
      margin: 8px 0;
    }
    .markdown-content pre code {
      background: none;
      padding: 0;
    }
    .markdown-content ul, .markdown-content ol {
      margin: 8px 0;
      padding-left: 20px;
    }
    .markdown-content li { margin: 4px 0; }
    .markdown-content blockquote {
      border-left: 3px solid var(--fill-tertiary, #ccc);
      margin: 8px 0;
      padding-left: 12px;
      color: var(--fill-secondary, #666);
    }
    .markdown-content table {
      border-collapse: collapse;
      margin: 8px 0;
      font-size: 12px;
    }
    .markdown-content th, .markdown-content td {
      border: 1px solid var(--fill-quinary, #ddd);
      padding: 6px 10px;
    }
    .markdown-content th {
      background: var(--fill-quinary, #f5f5f5);
    }
    .markdown-content a {
      color: #3B82F6;
      text-decoration: none;
    }
    .markdown-content a:hover {
      text-decoration: underline;
    }
    .markdown-content strong { font-weight: 600; }
    .markdown-content em { font-style: italic; }

    /* KaTeX styles */
    .katex { font-size: 1.1em; }
    .katex-display {
      display: block;
      margin: 12px 0;
      text-align: center;
      overflow-x: auto;
      overflow-y: hidden;
    }
    .katex-display > .katex {
      display: inline-block;
      text-align: initial;
    }
  `;
}

/**
 * Zotero Agent - Core functionality module
 *
 * MVP version: Select PDF, let LLM summarize
 */
export class AgentCore {
  private static llmService: LLMService | null = null;
  // Global chat history - shared across all tabs
  private static chatHistory: Array<{
    role: string;
    content: string;
    isUser: boolean;
    id: string;
  }> = [];
  // Save recent arXiv search results for downloading
  private static lastArxivResults: ArxivPaper[] = [];

  /**
   * Get LLM Service instance
   */
  static getLLMService(): LLMService {
    if (!this.llmService) {
      this.llmService = new LLMService();
    }
    return this.llmService;
  }

  /**
   * Reset LLM Service (call after config change)
   */
  static resetLLMService(): void {
    this.llmService = null;
  }

  /**
   * Register context menu items
   */
  static registerMenuItems() {
    const menuIcon = `chrome://${addon.data.config.addonRef}/content/icons/favicon@0.5x.png`;

    // Add "Summarize" option to item context menu
    ztoolkit.Menu.register("item", {
      tag: "menuitem",
      id: "zotero-itemmenu-agent-summarize",
      label: getString("menuitem-summarize"),
      commandListener: () => AgentCore.summarizeSelectedItem(),
      icon: menuIcon,
    });

    // Add "Ask" option to item context menu
    ztoolkit.Menu.register("item", {
      tag: "menuitem",
      id: "zotero-itemmenu-agent-ask",
      label: getString("menuitem-ask-agent"),
      commandListener: () => AgentCore.showAgentDialog(),
      icon: menuIcon,
    });

    // Development test menu - register to Tools menu
    ztoolkit.Menu.register("menuTools", {
      tag: "menu",
      id: "zotero-agent-test-menu",
      label: "Agent 测试",
      icon: menuIcon,
      children: [
        {
          tag: "menuitem",
          label: "测试: 获取选中文本",
          commandListener: () => AgentCore.testGetSelectedText(),
        },
        {
          tag: "menuitem",
          label: "测试: 获取当前条目",
          commandListener: () => AgentCore.testGetCurrentItem(),
        },
        {
          tag: "menuitem",
          label: "测试: LLM 连接",
          commandListener: () => AgentCore.testLLMConnection(),
        },
        {
          tag: "menuitem",
          label: "测试: arXiv 搜索",
          commandListener: () => AgentCore.testArxivSearch(),
        },
        {
          tag: "menuitem",
          label: "测试: 布局检查",
          commandListener: () => AgentCore.testLayout(),
        },
        {
          tag: "menuseparator",
        },
        {
          tag: "menuitem",
          label: "查看日志文件",
          commandListener: () => {
            const logPath = `${Zotero.DataDirectory.dir}/zotero-agent.log`;
            AgentCore.showNotification(`日志文件: ${logPath}`, "default");
            // Try to open with system command
            Zotero.launchFile(logPath);
          },
        },
      ],
    });
  }

  /**
   * Register sidebar panel
   */
  static registerSidebarPanel() {
    const logoIcon = `chrome://${addon.data.config.addonRef}/content/icons/favicon@0.5x.png`;

    const welcomeHTML = `
      <html:div id="agent-welcome" style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; padding: 20px; color: var(--fill-secondary); text-align: center;">
        <html:pre style="font-family: monospace; font-size: 12px; line-height: 1.2; margin: 0 0 16px 0; color: #F5A623;">    __
___( o)&gt;
\\ &lt;_. )
 \`---'</html:pre>
        <html:div style="font-weight: 600; font-size: 14px; margin-bottom: 12px; color: var(--fill-primary);">Zotero Agent</html:div>
        <html:div style="font-size: 13px; line-height: 1.6;">
          <html:p style="margin: 0 0 8px 0;">我可以帮你：</html:p>
          <html:div style="text-align: left; display: inline-block;">
            <html:p style="margin: 4px 0;">• 总结论文要点</html:p>
            <html:p style="margin: 4px 0;">• 解答研究问题</html:p>
            <html:p style="margin: 4px 0;">• 搜索 arXiv 论文</html:p>
          </html:div>
        </html:div>
      </html:div>
    `;

    // Register to ItemPaneManager (item details view)
    Zotero.ItemPaneManager.registerSection({
      paneID: "zotero-agent-chat",
      pluginID: addon.data.config.addonID,
      header: {
        l10nID: getLocaleID("sidebar-header"),
        icon: logoIcon,
      },
      sidenav: {
        l10nID: getLocaleID("sidebar-tooltip"),
        icon: logoIcon,
      },
      bodyXHTML: `
        <html:div id="agent-chat-container" style="display: flex; flex-direction: column; height: calc(100vh - 150px); box-sizing: border-box; overflow: hidden;">
          <html:div id="agent-chat-messages" style="flex: 1; overflow-y: auto; min-height: 0;">
            ${welcomeHTML}
          </html:div>
          <html:div id="agent-chat-input-wrapper" style="padding: 8px; border-top: 1px solid var(--fill-quinary); flex-shrink: 0;">
            <html:input type="text" id="agent-chat-input" placeholder="输入问题，按回车发送..." style="width: 100%; padding: 10px 12px; border: 1px solid var(--fill-quinary); border-radius: 6px; font-size: 13px; box-sizing: border-box; background: transparent; color: var(--fill-primary); outline: none;" />
          </html:div>
        </html:div>
      `,
      onInit: ({ body, item }) => {
        ztoolkit.log("Agent sidebar init", item?.id);

        const initAgent = () => {
          // Setup layout
          AgentCore.setupChatLayout(body);

          // Scroll to Agent panel
          AgentCore.scrollToAgent(body);

          // sidenav button click event
          const itemPane = body.closest("item-pane, .item-pane");
          if (itemPane) {
            const agentNavButton =
              itemPane.querySelector('[data-pane="zotero-agent-chat"]') ||
              itemPane.querySelector('toolbarbutton[data-l10n-id*="agent"]');
            if (
              agentNavButton &&
              !agentNavButton.getAttribute("data-exclusive-bound")
            ) {
              agentNavButton.setAttribute("data-exclusive-bound", "true");
              agentNavButton.addEventListener("click", () => {
                // Re-find current chat container on click
                const doc = ztoolkit.getGlobal("document");
                const currentContainer = doc.querySelector(
                  "#agent-chat-container",
                );
                if (currentContainer) {
                  const currentBody =
                    currentContainer.parentElement as HTMLElement;
                  AgentCore.scrollToAgent(currentBody);
                }
              });
            }
          }
        };

        setTimeout(initAgent, 200);
      },
      onItemChange: ({ item, setEnabled, tabType }) => {
        setEnabled(true);
        return true;
      },
      onRender: ({ body, item }) => {
        // Setup layout on each render
        AgentCore.setupChatLayout(body);

        const messagesDiv = body.querySelector(
          "#agent-chat-messages",
        ) as HTMLElement;

        // If there's chat history, restore it (replace welcome message)
        if (messagesDiv && AgentCore.chatHistory.length > 0) {
          // Check if already restored (avoid duplication)
          if (messagesDiv.querySelector("ul")) {
            AgentCore.restoreChatHistory(messagesDiv);
          }
        }

        const input = body.querySelector(
          "#agent-chat-input",
        ) as HTMLInputElement;
        if (input && !input.dataset.bound) {
          input.dataset.bound = "true";

          // Highlight border on focus
          input.addEventListener("focus", () => {
            input.style.borderColor = "var(--accent-blue)";
          });
          input.addEventListener("blur", () => {
            input.style.borderColor = "var(--fill-quinary)";
          });

          input.addEventListener("keydown", async (e: KeyboardEvent) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              const question = input.value.trim();
              if (!question) return;

              Logger.info("Chat", "User question", question);

              const messagesDiv = body.querySelector(
                "#agent-chat-messages",
              ) as HTMLElement;
              if (!messagesDiv) return;

              // Clear welcome message (only on first send)
              if (messagesDiv.querySelector("#agent-welcome")) {
                messagesDiv.innerHTML = "";
              }

              // Display user message
              AgentCore.appendMessage(messagesDiv, question, true);
              input.value = "";

              // Check if it's a download command (e.g., "下载 1" or "下载第2篇")
              const downloadMatch = question.match(/下载\s*(?:第?\s*)?(\d+)/);
              if (downloadMatch && AgentCore.lastArxivResults.length > 0) {
                const index = parseInt(downloadMatch[1]) - 1;
                if (index >= 0 && index < AgentCore.lastArxivResults.length) {
                  await AgentCore.handleArxivDownload(messagesDiv, index);
                  return;
                }
              }

              // Check if it's an arXiv search request
              const isArxivSearch =
                /arxiv|arXiv|查找.*论文|搜索.*论文|相关.*论文|找.*文献/.test(
                  question,
                );

              // Show loading
              const loadingId = AgentCore.appendMessage(
                messagesDiv,
                isArxivSearch ? "正在搜索 arXiv..." : "思考中...",
                false,
                true,
              );

              try {
                // Check API Key (arXiv search doesn't need it, but LLM does)
                const apiKey = getPref("llm.apiKey") as string;

                // Get current paper context
                const ZoteroPane = ztoolkit.getGlobal("ZoteroPane");
                const selectedItems = ZoteroPane.getSelectedItems();
                const currentItem =
                  selectedItems.length > 0 ? selectedItems[0] : null;
                const metadata = currentItem
                  ? PDFService.getItemMetadata(currentItem)
                  : null;

                // Handle arXiv search
                if (isArxivSearch) {
                  await AgentCore.handleArxivSearch(
                    messagesDiv,
                    loadingId,
                    question,
                    metadata,
                  );
                  return;
                }

                // Regular chat handling
                if (!apiKey) {
                  Logger.warn("Chat", "API Key not configured");
                  AgentCore.removeMessage(messagesDiv, loadingId);
                  AgentCore.appendMessage(
                    messagesDiv,
                    "请先在设置中配置 API Key",
                    false,
                  );
                  return;
                }

                // Check if there's selected text in PDF
                const selectedText = PDFService.getSelectedText();
                Logger.debug(
                  "Chat",
                  "Selected text",
                  selectedText ? `${selectedText.length} chars` : "none",
                );
                Logger.debug("Chat", "Current item", metadata?.title || "none");

                // Build context
                let context = "";
                if (selectedText) {
                  context = `用户在 PDF 中选中的文本：
"""
${selectedText}
"""

`;
                }

                if (currentItem && metadata) {
                  context += `当前论文信息：
标题：${metadata.title}
作者：${metadata.authors}
年份：${metadata.year}
摘要：${metadata.abstract || "无"}

`;
                  if (!selectedText) {
                    try {
                      Logger.debug("Chat", "Attempting to get PDF attachment", {
                        itemId: currentItem.id,
                        itemType: currentItem.itemType,
                      });
                      const pdfItem =
                        await PDFService.getPDFAttachment(currentItem);
                      Logger.debug("Chat", "PDF attachment result", {
                        found: !!pdfItem,
                        pdfItemId: pdfItem?.id,
                        pdfContentType: pdfItem?.attachmentContentType,
                      });
                      if (pdfItem) {
                        let fullText =
                          await PDFService.extractFullText(pdfItem);
                        fullText = PDFService.truncateText(fullText, 4000);
                        Logger.debug(
                          "Chat",
                          "PDF text extracted",
                          `${fullText.length} chars`,
                        );
                        context += `论文内容：
${fullText}

`;
                      } else {
                        Logger.warn(
                          "Chat",
                          "No PDF attachment found for item",
                          { itemId: currentItem.id },
                        );
                      }
                    } catch (e: any) {
                      Logger.error("Chat", "Failed to extract PDF", {
                        message: e.message,
                        stack: e.stack?.substring(0, 300),
                      });
                    }
                  }
                }

                Logger.debug(
                  "Chat",
                  "Context length",
                  `${context.length} chars`,
                );

                const systemPrompt = `你是 Zotero Agent，一个学术研究助手。请用中文回答用户的问题。如果用户提供了选中的文本，请针对该选中内容回答。如果用户询问的是当前论文相关的问题，请基于提供的论文内容回答。回答要简洁、准确、专业。`;

                Logger.info("Chat", "Calling LLM...");
                const llmService = AgentCore.getLLMService();
                const response = await llmService.chat([
                  { role: "system", content: systemPrompt },
                  { role: "user", content: context + "用户问题：" + question },
                ]);

                Logger.info(
                  "Chat",
                  "LLM response received",
                  `${response.length} chars`,
                );

                AgentCore.removeMessage(messagesDiv, loadingId);
                AgentCore.appendMessage(messagesDiv, response, false);
              } catch (error: any) {
                Logger.error("Chat", "Error", error.message);
                AgentCore.removeMessage(messagesDiv, loadingId);
                AgentCore.appendMessage(
                  messagesDiv,
                  `错误: ${error.message}`,
                  false,
                );
              }
            }
          });
        }
      },
    });
  }

  /**
   * Add message to chat area and save to history
   */
  private static appendMessage(
    container: HTMLElement,
    text: string,
    isUser: boolean,
    isLoading = false,
  ): string {
    const msgId = `msg-${Date.now()}`;

    // Non-loading messages saved to history
    if (!isLoading) {
      this.chatHistory.push({
        role: isUser ? "user" : "assistant",
        content: text,
        isUser,
        id: msgId,
      });
      // Sync to all open panels
      this.syncMessageToAllPanels(text, isUser, msgId);
    }

    // Render to current container
    this.renderMessageToContainer(container, text, isUser, isLoading, msgId);

    return msgId;
  }

  /**
   * Render single message to container
   */
  private static renderMessageToContainer(
    container: HTMLElement,
    text: string,
    isUser: boolean,
    isLoading: boolean,
    msgId: string,
  ) {
    const doc = container.ownerDocument;
    if (!doc) return;

    // Skip if message already exists
    if (container.querySelector(`#${msgId}`)) return;

    // Inject markdown styles if not already present
    if (!doc.getElementById("zotero-agent-markdown-styles")) {
      const styleEl = doc.createElement("style");
      styleEl.id = "zotero-agent-markdown-styles";
      styleEl.textContent = getMarkdownStyles();
      doc.head?.appendChild(styleEl);
    }

    const msgDiv = doc.createElement("div");
    msgDiv.id = msgId;
    msgDiv.style.cssText = `
      padding: 12px;
      font-size: 13px;
      line-height: 1.6;
      border-bottom: 1px solid var(--fill-quinary);
      ${isLoading ? "opacity: 0.6;" : ""}
    `;

    // Add label
    const labelDiv = doc.createElement("div");
    labelDiv.style.cssText = `
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 6px;
      color: ${isUser ? "#3B82F6" : "#F59E0B"};
    `;
    labelDiv.textContent = isUser ? "You" : "Agent";
    msgDiv.appendChild(labelDiv);

    // Add content
    const contentDiv = doc.createElement("div");
    // Use different styles for user vs agent messages
    if (isUser || isLoading) {
      contentDiv.style.cssText = `
        color: var(--fill-primary);
        white-space: pre-wrap;
        word-wrap: break-word;
        ${isLoading ? "font-style: italic;" : ""}
      `;
      contentDiv.textContent = text;
    } else {
      contentDiv.className = "markdown-content";
      contentDiv.style.cssText = `
        color: var(--fill-primary);
        word-wrap: break-word;
      `;
      contentDiv.innerHTML = renderMarkdown(text, isUser);
    }
    msgDiv.appendChild(contentDiv);

    container.appendChild(msgDiv);

    // Scroll messages to bottom
    container.scrollTop = container.scrollHeight;
  }

  /**
   * Sync message to all open Agent panels
   */
  private static syncMessageToAllPanels(
    text: string,
    isUser: boolean,
    msgId: string,
  ) {
    const doc = ztoolkit.getGlobal("document");
    const allMessageDivs = doc.querySelectorAll("#agent-chat-messages");
    allMessageDivs.forEach((messagesDiv: Element) => {
      this.renderMessageToContainer(
        messagesDiv as HTMLElement,
        text,
        isUser,
        false,
        msgId,
      );
    });
  }

  /**
   * Restore chat history to panel
   */
  private static restoreChatHistory(container: HTMLElement) {
    // Clear welcome message
    container.innerHTML = "";

    // Restore all history messages
    for (const msg of this.chatHistory) {
      this.renderMessageToContainer(
        container,
        msg.content,
        msg.isUser,
        false,
        msg.id,
      );
    }

    Logger.debug("Chat", "Restored chat history", {
      count: this.chatHistory.length,
    });
  }

  /**
   * Remove specified message
   */
  private static removeMessage(container: HTMLElement, msgId: string) {
    const msg = container.querySelector(`#${msgId}`);
    if (msg) msg.remove();
  }

  /**
   * Register shortcuts
   */
  static registerShortcuts() {
    ztoolkit.Keyboard.register((ev, keyOptions) => {
      // Ctrl/Cmd + Shift + A open Agent dialog
      if (ev.ctrlKey && ev.shiftKey && ev.key.toLowerCase() === "a") {
        AgentCore.showAgentDialog();
      }
      // Ctrl/Cmd + Shift + S summarize selected paper
      if (ev.ctrlKey && ev.shiftKey && ev.key.toLowerCase() === "s") {
        AgentCore.summarizeSelectedItem();
      }
    });
  }

  /**
   * Summarize selected item
   */
  static async summarizeSelectedItem() {
    const ZoteroPane = ztoolkit.getGlobal("ZoteroPane");
    const selectedItems = ZoteroPane.getSelectedItems();

    if (selectedItems.length === 0) {
      AgentCore.showNotification(getString("error-no-selection"), "error");
      return;
    }

    const item = selectedItems[0];

    // Check API Key configuration
    const apiKey = getPref("llm.apiKey") as string;
    if (!apiKey) {
      AgentCore.showNotification(getString("error-no-apikey"), "error");
      AgentCore.showSettingsDialog();
      return;
    }

    // Get PDF attachment
    const pdfItem = await PDFService.getPDFAttachment(item);
    if (!pdfItem) {
      AgentCore.showNotification(getString("error-no-pdf"), "error");
      return;
    }

    // Show progress
    const progressWin = new ztoolkit.ProgressWindow(
      addon.data.config.addonName,
      {
        closeOnClick: false,
        closeTime: -1,
      },
    )
      .createLine({
        text: getString("progress-extracting"),
        type: "default",
        progress: 0,
      })
      .show();

    try {
      // Extract PDF text
      progressWin.changeLine({
        text: getString("progress-extracting"),
        progress: 30,
      });
      let fullText = await PDFService.extractFullText(pdfItem);

      // Get metadata
      const metadata = PDFService.getItemMetadata(item);

      // Truncate text (avoid exceeding token limit)
      fullText = PDFService.truncateText(fullText, 6000);

      // Call LLM to summarize
      progressWin.changeLine({
        text: getString("progress-summarizing"),
        progress: 60,
      });

      const prompt = `论文标题：${metadata.title}
作者：${metadata.authors}
年份：${metadata.year}

以下是论文内容：

${fullText}

请对这篇论文进行总结，包括：
1. 研究问题/目标
2. 主要方法
3. 关键发现/结论
4. 主要贡献`;

      const llmService = AgentCore.getLLMService();
      const summary = await llmService.summarize(prompt, "zh");

      progressWin.changeLine({
        text: getString("progress-done"),
        progress: 100,
      });
      progressWin.startCloseTimer(2000);

      // Show result dialog
      AgentCore.showResultDialog(metadata.title, summary);
    } catch (error: any) {
      progressWin.changeLine({
        text: `Error: ${error.message}`,
        type: "error",
        progress: 100,
      });
      progressWin.startCloseTimer(5000);
      ztoolkit.log("Summarize error:", error);
    }
  }

  /**
   * Show result dialog
   */
  static showResultDialog(title: string, content: string) {
    const dialogData: { [key: string | number]: any } = {
      loadCallback: () => {},
      unloadCallback: () => {},
    };

    // Convert markdown to simple HTML
    const htmlContent = content
      .replace(/\n\n/g, "</p><p>")
      .replace(/\n/g, "<br>")
      .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.*?)\*/g, "<em>$1</em>");

    new ztoolkit.Dialog(3, 1)
      .addCell(0, 0, {
        tag: "h3",
        styles: { margin: "0 0 10px 0" },
        properties: { innerHTML: `📄 ${title}` },
      })
      .addCell(1, 0, {
        tag: "div",
        styles: {
          maxHeight: "400px",
          overflow: "auto",
          padding: "15px",
          backgroundColor: "#f9f9f9",
          borderRadius: "4px",
          lineHeight: "1.6",
        },
        properties: { innerHTML: `<p>${htmlContent}</p>` },
      })
      .addCell(2, 0, {
        tag: "div",
        styles: {
          marginTop: "10px",
          display: "flex",
          gap: "10px",
        },
        children: [
          {
            tag: "button",
            namespace: "html",
            properties: { innerHTML: getString("button-copy") },
            listeners: [
              {
                type: "click",
                listener: () => {
                  new ztoolkit.Clipboard()
                    .addText(content, "text/unicode")
                    .copy();
                  AgentCore.showNotification(getString("copied"), "success");
                },
              },
            ],
          },
        ],
      })
      .addButton(getString("agent-button-close"), "close")
      .setDialogData(dialogData)
      .open(getString("result-dialog-title"), {
        width: 600,
        height: 500,
        centerscreen: true,
        resizable: true,
      });
  }

  /**
   * Show Agent dialog (kept as backup)
   */
  static async showAgentDialog() {
    // Check API Key configuration
    const apiKey = getPref("llm.apiKey") as string;
    if (!apiKey) {
      AgentCore.showNotification(getString("error-no-apikey"), "error");
      AgentCore.showSettingsDialog();
      return;
    }

    AgentCore.showNotification("请使用右侧侧边栏的 Agent 面板", "default");
  }

  /**
   * Show settings dialog
   */
  static showSettingsDialog() {
    // Open Zotero preferences and navigate to plugin settings
    const Zotero = ztoolkit.getGlobal("Zotero") as any;
    Zotero.Prefs?.openPrefs?.(addon.data.config.addonID) ||
      Zotero.openPreferences?.("zotero-prefpane-" + addon.data.config.addonRef);
  }

  /**
   * Show notification
   */
  static showNotification(
    message: string,
    type: "success" | "error" | "default" = "default",
  ) {
    new ztoolkit.ProgressWindow(addon.data.config.addonName, {
      closeOnClick: true,
      closeTime: 3000,
    })
      .createLine({
        text: message,
        type: type === "error" ? "fail" : type,
        progress: 100,
      })
      .show();
  }

  /**
   * Show startup notification
   */
  static showStartupNotification() {
    new ztoolkit.ProgressWindow(addon.data.config.addonName, {
      closeOnClick: true,
      closeTime: 3000,
    })
      .createLine({
        text: getString("startup-message"),
        type: "success",
        progress: 100,
      })
      .show();
  }

  // ============ Layout Management ============

  /**
   * Setup chat area layout - CSS already configured, just logging here
   */
  static setupChatLayout(body: HTMLElement) {
    const container = body.querySelector(
      "#agent-chat-container",
    ) as HTMLElement;
    if (!container) {
      Logger.warn("Layout", "setupChatLayout: container not found");
      return;
    }

    const rect = container.getBoundingClientRect();
    Logger.info("Layout", "setupChatLayout", {
      containerTop: rect.top,
      containerHeight: rect.height,
    });
  }

  /**
   * Scroll messages to bottom
   */
  static scrollMessagesToBottom(body: HTMLElement) {
    const messagesDiv = body.querySelector(
      "#agent-chat-messages",
    ) as HTMLElement;
    if (messagesDiv) {
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    }
  }

  /**
   * Dynamically adjust chat area height to fit different screen sizes
   */
  static adjustChatHeight(body: HTMLElement) {
    const sectionBody = body.closest(".item-pane-section-body") as HTMLElement;
    if (!sectionBody) return;

    // Get available height of sidebar
    const itemPane = body.closest("item-pane, .item-pane") as HTMLElement;
    if (!itemPane) return;

    const paneRect = itemPane.getBoundingClientRect();
    const sectionRect = sectionBody.getBoundingClientRect();

    // Calculate available space from current position to bottom of sidebar
    // Reserve 20px bottom margin
    const availableHeight = paneRect.bottom - sectionRect.top - 20;

    // Set minimum height 300px, max not exceeding available space
    const targetHeight = Math.max(
      300,
      Math.min(availableHeight, paneRect.height * 0.7),
    );

    sectionBody.style.height = `${targetHeight}px`;
    sectionBody.style.maxHeight = `${targetHeight}px`;
    sectionBody.style.overflow = "hidden";

    Logger.debug("Layout", "Adjusted chat height", {
      paneHeight: paneRect.height,
      availableHeight,
      targetHeight,
    });

    // Verify layout correctness
    setTimeout(() => AgentCore.verifyLayout(body), 100);
  }

  /**
   * Verify layout correctness - ensure input box is within viewport
   */
  static verifyLayout(body: HTMLElement): boolean {
    const input = body.querySelector("#agent-chat-input") as HTMLElement;
    const messagesDiv = body.querySelector(
      "#agent-chat-messages",
    ) as HTMLElement;

    if (!input || !messagesDiv) {
      Logger.warn("Layout", "Layout elements not found");
      return false;
    }

    const win = ztoolkit.getGlobal("window");
    const inputRect = input.getBoundingClientRect();
    const viewportHeight = win.innerHeight;

    // Check if input box is within viewport
    const inputVisible =
      inputRect.top >= 0 && inputRect.bottom <= viewportHeight;

    // Check if messages area is scrollable (has overflow-y: auto and content may overflow)
    const messagesStyle = win.getComputedStyle(messagesDiv);
    const messagesScrollable =
      messagesStyle.overflowY === "auto" ||
      messagesStyle.overflowY === "scroll";

    if (!inputVisible) {
      Logger.error("Layout", "INPUT BOX NOT VISIBLE!", {
        inputTop: inputRect.top,
        inputBottom: inputRect.bottom,
        viewportHeight,
      });
    }

    if (!messagesScrollable) {
      Logger.error("Layout", "Messages area not scrollable!", {
        overflowY: messagesStyle.overflowY,
      });
    }

    return inputVisible && messagesScrollable;
  }

  /**
   * Scroll to Agent panel and maximize display
   */
  static scrollToAgent(body: HTMLElement) {
    Logger.info("Agent", "scrollToAgent called");

    const agentSection = body.closest("[data-pane]") as HTMLElement;
    if (!agentSection) {
      Logger.warn("Agent", "Could not find agent section");
      return;
    }

    // Find sidebar scroll container
    const scrollContainer = agentSection.closest(
      ".item-pane-content, item-pane",
    ) as HTMLElement;

    // Scroll to Agent section
    agentSection.scrollIntoView({ behavior: "smooth", block: "start" });
    Logger.info("Agent", "scrollIntoView called");

    // Ensure Agent section is expanded
    const header = agentSection.querySelector("collapsible-section-header");
    if (header && !agentSection.hasAttribute("open")) {
      (header as HTMLElement).click();
    }

    // Try recalculating layout multiple times to ensure scroll completes
    const recalculate = (attempt: number) => {
      const container = body.querySelector(
        "#agent-chat-container",
      ) as HTMLElement;
      if (!container) return;

      const rect = container.getBoundingClientRect();
      Logger.info("Agent", `Layout recalc attempt ${attempt}`, {
        containerTop: rect.top,
      });

      AgentCore.setupChatLayout(body);

      // If container top is still too large (scroll not complete), keep waiting
      if (rect.top > 200 && attempt < 5) {
        setTimeout(() => recalculate(attempt + 1), 200);
      }
    };

    setTimeout(() => recalculate(1), 100);
  }

  // ============ arXiv Search and Download ============

  /**
   * Handle arXiv search request
   */
  private static async handleArxivSearch(
    messagesDiv: HTMLElement,
    loadingId: string,
    question: string,
    metadata: {
      title: string;
      authors: string;
      year: string;
      abstract: string;
    } | null,
  ) {
    try {
      // Generate search keywords
      let searchQuery: string;

      if (metadata) {
        // Generate keywords based on current paper
        searchQuery = ArxivService.generateSearchQuery(
          metadata.title,
          metadata.abstract,
        );
        Logger.info("Arxiv", "Generated search query from paper", searchQuery);
      } else {
        // Extract keywords from user question
        searchQuery = question
          .replace(/在\s*arxiv\s*上?/gi, "")
          .replace(/查找|搜索|找|相关|论文|文献/g, "")
          .trim();
        Logger.info("Arxiv", "Search query from user input", searchQuery);
      }

      if (!searchQuery) {
        AgentCore.removeMessage(messagesDiv, loadingId);
        AgentCore.appendMessage(
          messagesDiv,
          "请提供搜索关键词，或先选中一篇论文",
          false,
        );
        return;
      }

      // Execute search
      const result = await ArxivService.search(searchQuery, 5);
      AgentCore.lastArxivResults = result.papers;

      AgentCore.removeMessage(messagesDiv, loadingId);

      if (result.papers.length === 0) {
        AgentCore.appendMessage(
          messagesDiv,
          `未找到与 "${searchQuery}" 相关的论文`,
          false,
        );
        return;
      }

      // Format search results
      let response = `**arXiv 搜索结果** (关键词: ${searchQuery})\n\n`;
      result.papers.forEach((paper, index) => {
        response += ArxivService.formatPaperForDisplay(paper, index) + "\n\n";
      });
      response += `---\n💡 输入 "下载 1" 或 "下载 2" 可下载对应论文到 Zotero`;

      AgentCore.appendMessage(messagesDiv, response, false);
    } catch (error: any) {
      Logger.error("Arxiv", "Search error", error.message);
      AgentCore.removeMessage(messagesDiv, loadingId);
      AgentCore.appendMessage(
        messagesDiv,
        `arXiv 搜索失败: ${error.message}`,
        false,
      );
    }
  }

  /**
   * Handle arXiv download request
   */
  private static async handleArxivDownload(
    messagesDiv: HTMLElement,
    index: number,
  ) {
    const paper = AgentCore.lastArxivResults[index];
    if (!paper) {
      AgentCore.appendMessage(messagesDiv, "无效的论文编号", false);
      return;
    }

    const loadingId = AgentCore.appendMessage(
      messagesDiv,
      `正在下载: ${paper.title.substring(0, 50)}...`,
      false,
      true,
    );

    try {
      const item = await ArxivService.downloadAndImport(paper);

      AgentCore.removeMessage(messagesDiv, loadingId);

      if (item) {
        AgentCore.appendMessage(
          messagesDiv,
          `✅ 下载成功!\n**${paper.title}**\n已添加到 Zotero 库中，PDF 已下载。`,
          false,
        );
        AgentCore.showNotification("论文已添加到 Zotero", "success");
      } else {
        AgentCore.appendMessage(messagesDiv, "下载失败，请重试", false);
      }
    } catch (error: any) {
      Logger.error("Arxiv", "Download error", error.message);
      AgentCore.removeMessage(messagesDiv, loadingId);
      AgentCore.appendMessage(messagesDiv, `下载失败: ${error.message}`, false);
    }
  }

  // ============ Test Methods ============

  /**
   * Test: Get PDF selected text
   */
  static testGetSelectedText() {
    const selectedText = PDFService.getSelectedText();
    if (selectedText) {
      AgentCore.showNotification(
        `选中文本 (${selectedText.length}字): ${selectedText.substring(0, 50)}...`,
        "success",
      );
      ztoolkit.log("[Test] Selected text:", selectedText);
    } else {
      AgentCore.showNotification(
        "未检测到选中文本，请先在 PDF 中选中一段文字",
        "error",
      );
    }
  }

  /**
   * Test: Get current item
   */
  static testGetCurrentItem() {
    const ZoteroPane = ztoolkit.getGlobal("ZoteroPane");
    const selectedItems = ZoteroPane.getSelectedItems();
    if (selectedItems.length > 0) {
      const item = selectedItems[0];
      const metadata = PDFService.getItemMetadata(item);
      AgentCore.showNotification(`当前条目: ${metadata.title}`, "success");
      ztoolkit.log("[Test] Current item:", metadata);
    } else {
      AgentCore.showNotification("未选中任何条目", "error");
    }
  }

  /**
   * Test: LLM connection
   */
  static async testLLMConnection() {
    const apiKey = getPref("llm.apiKey") as string;
    if (!apiKey) {
      AgentCore.showNotification("API Key 未配置", "error");
      return;
    }

    AgentCore.showNotification("正在测试 LLM 连接...", "default");

    try {
      const llmService = AgentCore.getLLMService();
      const result = await llmService.testConnection();
      if (result) {
        AgentCore.showNotification("LLM 连接成功!", "success");
      } else {
        AgentCore.showNotification("LLM 连接失败", "error");
      }
    } catch (e: any) {
      AgentCore.showNotification(`LLM 连接错误: ${e.message}`, "error");
      ztoolkit.log("[Test] LLM error:", e);
    }
  }

  /**
   * Test: arXiv search
   */
  static async testArxivSearch() {
    const ZoteroPane = ztoolkit.getGlobal("ZoteroPane");
    const selectedItems = ZoteroPane.getSelectedItems();

    let query = "transformer attention mechanism";

    if (selectedItems.length > 0) {
      const item = selectedItems[0];
      const metadata = PDFService.getItemMetadata(item);
      query = ArxivService.generateSearchQuery(
        metadata.title,
        metadata.abstract,
      );
      AgentCore.showNotification(`搜索关键词: ${query}`, "default");
    } else {
      AgentCore.showNotification(`使用默认关键词: ${query}`, "default");
    }

    try {
      const result = await ArxivService.search(query, 3);
      if (result.papers.length > 0) {
        const firstPaper = result.papers[0];
        AgentCore.showNotification(
          `找到 ${result.papers.length} 篇论文\n第一篇: ${firstPaper.title.substring(0, 50)}...`,
          "success",
        );
        Logger.info(
          "Test",
          "arXiv search results",
          result.papers.map((p) => p.title),
        );
      } else {
        AgentCore.showNotification("未找到相关论文", "error");
      }
    } catch (e: any) {
      AgentCore.showNotification(`arXiv 搜索失败: ${e.message}`, "error");
      Logger.error("Test", "arXiv search error", e);
    }
  }

  /**
   * Test: Layout check - verify chat interface layout correctness
   */
  static testLayout() {
    // Find Agent panel
    const doc = ztoolkit.getGlobal("document");
    const agentBody = doc
      .querySelector("#agent-chat-container")
      ?.closest(".item-pane-section-body") as HTMLElement;

    if (!agentBody) {
      AgentCore.showNotification("未找到 Agent 面板，请先展开面板", "error");
      return;
    }

    const container = agentBody.querySelector(
      "#agent-chat-container",
    ) as HTMLElement;
    const input = agentBody.querySelector("#agent-chat-input") as HTMLElement;
    const messagesDiv = agentBody.querySelector(
      "#agent-chat-messages",
    ) as HTMLElement;

    if (!container || !input || !messagesDiv) {
      AgentCore.showNotification("布局元素缺失!", "error");
      Logger.error("LayoutTest", "Missing elements", {
        container: !!container,
        input: !!input,
        messagesDiv: !!messagesDiv,
      });
      return;
    }

    const issues: string[] = [];

    // 1. Check if input box is within viewport
    const inputRect = input.getBoundingClientRect();
    const win = ztoolkit.getGlobal("window");
    const viewportHeight = win.innerHeight;

    if (inputRect.bottom > viewportHeight) {
      issues.push(
        `Input box exceeds viewport (bottom: ${inputRect.bottom.toFixed(0)}, viewport: ${viewportHeight})`,
      );
    }

    if (inputRect.top < 0) {
      issues.push(
        `Input box above viewport (top: ${inputRect.top.toFixed(0)})`,
      );
    }

    // 2. Check if messages area is scrollable
    const messagesStyle = win.getComputedStyle(messagesDiv);
    if (
      messagesStyle.overflowY !== "auto" &&
      messagesStyle.overflowY !== "scroll"
    ) {
      issues.push(
        `Messages area not scrollable (overflow-y: ${messagesStyle.overflowY})`,
      );
    }

    // 3. Check flex layout
    const containerStyle = win.getComputedStyle(container);
    if (containerStyle.display !== "flex") {
      issues.push(
        `Container not flex layout (display: ${containerStyle.display})`,
      );
    }

    // 4. Check section body height
    const sectionBodyRect = agentBody.getBoundingClientRect();
    if (sectionBodyRect.height < 200) {
      issues.push(
        `Panel height too small (height: ${sectionBodyRect.height.toFixed(0)}px)`,
      );
    }

    // 5. Check min-height: 0 (key for flex scrolling)
    if (messagesStyle.minHeight !== "0px") {
      issues.push(
        `Messages area min-height not 0 (actual: ${messagesStyle.minHeight})`,
      );
    }

    // Output results
    if (issues.length === 0) {
      AgentCore.showNotification("✅ 布局检查通过!", "success");
      Logger.info("LayoutTest", "All checks passed", {
        inputBottom: inputRect.bottom,
        viewportHeight,
        sectionHeight: sectionBodyRect.height,
      });
    } else {
      AgentCore.showNotification(
        `❌ 布局问题: ${issues.length} 个\n${issues[0]}`,
        "error",
      );
      Logger.error("LayoutTest", "Layout issues found", issues);
    }

    return issues;
  }
}
