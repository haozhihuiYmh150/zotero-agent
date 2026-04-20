/**
 * Side Panel - Standalone side panel
 *
 * Features:
 * - Fixed on the right side
 * - All views share the same session
 * - Can be collapsed to a small icon, takes no space
 */

import { Logger } from "../utils/logger";
import { LLMService } from "../services/LLMService";
import { PDFService } from "../services/PDFService";
import { getPref } from "../utils/prefs";
import { ToolRegistry, ToolContext } from "../tools";
import { commandRegistry } from "../commands";

export class SidePanel {
  private static instance: SidePanel | null = null;
  private static panelId = "zotero-agent-side-panel";
  private static toggleBtnId = "zotero-agent-toggle-btn";
  private static defaultWidth = 320;

  // Global chat history
  private static chatHistory: Array<{ role: string; content: string; isUser: boolean; id: string }> = [];
  // User input history (for up/down arrow navigation)
  private static inputHistory: string[] = [];
  private static inputHistoryIndex = -1;
  private static currentInput = ""; // Save current unsent input
  // Command menu selection index
  private static commandMenuIndex = -1;
  // LLM Service
  private static llmService: LLMService | null = null;
  // Tool registry
  private static toolRegistry: ToolRegistry | null = null;

  private panel: HTMLElement | null = null;
  private toggleBtn: HTMLElement | null = null;
  private messagesContainer: HTMLElement | null = null;
  private isCollapsed = true; // Default to collapsed
  private isProcessing = false; // Whether waiting for Agent response

  static getInstance(): SidePanel {
    if (!this.instance) {
      this.instance = new SidePanel();
    }
    return this.instance;
  }

  static getLLMService(): LLMService {
    if (!this.llmService) {
      this.llmService = new LLMService();
    }
    return this.llmService;
  }

  static getToolRegistry(): ToolRegistry {
    if (!this.toolRegistry) {
      this.toolRegistry = new ToolRegistry(this.getLLMService());
    }
    return this.toolRegistry;
  }

  /**
   * Initialize
   */
  init() {
    const doc = ztoolkit.getGlobal("document");
    this.destroy();

    // Create small icon when collapsed
    this.createToggleButton(doc);

    // Create panel (hidden by default)
    this.createPanel(doc);

    if (doc.documentElement) {
      doc.documentElement.appendChild(this.toggleBtn!);
      doc.documentElement.appendChild(this.panel!);
    }

    Logger.info("SidePanel", "Initialized");
  }

  /**
   * Create collapsed state small icon button (draggable to any position)
   */
  private createToggleButton(doc: Document) {
    const logoIcon = `chrome://${addon.data.config.addonRef}/content/icons/favicon.png`;

    // Read saved position from config
    const savedPos = this.getSavedPosition();
    const win = ztoolkit.getGlobal("window");

    // Default to bottom-right corner, using left/top positioning to support any position
    const defaultLeft = win.innerWidth - 60;
    const defaultTop = win.innerHeight - 128;

    this.toggleBtn = doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLElement;
    this.toggleBtn.id = SidePanel.toggleBtnId;
    this.toggleBtn.style.cssText = `
      position: fixed;
      left: ${savedPos.left ?? defaultLeft}px;
      top: ${savedPos.top ?? defaultTop}px;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: var(--material-background, #fff);
      border: 1px solid var(--fill-quinary, #ddd);
      box-shadow: 0 2px 8px rgba(0,0,0,0.15);
      cursor: grab;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      transition: box-shadow 0.2s;
      user-select: none;
    `;
    this.toggleBtn.innerHTML = `<img src="${logoIcon}" style="width: 28px; height: 28px; border-radius: 4px; pointer-events: none;" />`;

    // Drag functionality
    let isDragging = false;
    let hasMoved = false;
    let startX = 0, startY = 0;
    let startLeft = 0, startTop = 0;

    this.toggleBtn.addEventListener("mousedown", (e: MouseEvent) => {
      isDragging = true;
      hasMoved = false;
      startX = e.clientX;
      startY = e.clientY;
      startLeft = parseInt(this.toggleBtn!.style.left) || 0;
      startTop = parseInt(this.toggleBtn!.style.top) || 0;
      this.toggleBtn!.style.cursor = "grabbing";
      e.preventDefault();
    });

    doc.addEventListener("mousemove", (e: MouseEvent) => {
      if (!isDragging || !this.toggleBtn) return;

      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      // Check if actually moved (avoid accidental trigger on click)
      if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
        hasMoved = true;
      }

      const win = ztoolkit.getGlobal("window");
      let newLeft = startLeft + deltaX;
      let newTop = startTop + deltaY;

      // Boundary limits - allow dragging to any position on screen
      newLeft = Math.max(0, Math.min(win.innerWidth - 48, newLeft));
      newTop = Math.max(0, Math.min(win.innerHeight - 48, newTop));

      this.toggleBtn.style.left = `${newLeft}px`;
      this.toggleBtn.style.top = `${newTop}px`;
    });

    doc.addEventListener("mouseup", () => {
      if (isDragging && this.toggleBtn) {
        isDragging = false;
        this.toggleBtn.style.cursor = "grab";

        // Save position
        this.savePosition();

        // If no movement, it's a click, expand panel
        if (!hasMoved) {
          this.expand();
        }
      }
    });

    // Hover effect
    this.toggleBtn.addEventListener("mouseenter", () => {
      if (!isDragging) {
        this.toggleBtn!.style.boxShadow = "0 4px 12px rgba(0,0,0,0.25)";
      }
    });
    this.toggleBtn.addEventListener("mouseleave", () => {
      if (!isDragging) {
        this.toggleBtn!.style.boxShadow = "0 2px 8px rgba(0,0,0,0.15)";
      }
    });
  }

  /**
   * Save icon position
   */
  private savePosition() {
    if (!this.toggleBtn) return;
    const pos = {
      left: parseInt(this.toggleBtn.style.left) || 0,
      top: parseInt(this.toggleBtn.style.top) || 0,
    };
    try {
      Zotero.Prefs.set("extensions.zoteroagent.toggleBtnPos", JSON.stringify(pos));
    } catch (e) {
      // ignore
    }
  }

  /**
   * Get saved position
   */
  private getSavedPosition(): { left?: number; top?: number } {
    try {
      const saved = Zotero.Prefs.get("extensions.zoteroagent.toggleBtnPos") as string;
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      // ignore
    }
    return {};
  }

  /**
   * Create main panel
   */
  private createPanel(doc: Document) {
    const logoIcon = `chrome://${addon.data.config.addonRef}/content/icons/favicon.png`;

    // Read saved width
    const savedWidth = this.getSavedWidth();

    this.panel = doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLElement;
    this.panel.id = SidePanel.panelId;
    this.panel.style.cssText = `
      position: fixed;
      right: 0;
      top: 0;
      width: ${savedWidth}px;
      height: 100vh;
      display: none;
      flex-direction: column;
      background: var(--material-background, #fff);
      border-left: 1px solid var(--fill-quinary, #ddd);
      box-shadow: -2px 0 8px rgba(0,0,0,0.1);
      z-index: 10001;
      box-sizing: border-box;
    `;

    // Left drag edge (adjust width)
    const resizeHandle = doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLElement;
    resizeHandle.style.cssText = `
      position: absolute;
      left: 0;
      top: 0;
      width: 6px;
      height: 100%;
      cursor: ew-resize;
      background: transparent;
      z-index: 10;
    `;
    resizeHandle.addEventListener("mouseenter", () => {
      resizeHandle.style.background = "var(--accent-blue, #3B82F6)";
      resizeHandle.style.opacity = "0.3";
    });
    resizeHandle.addEventListener("mouseleave", () => {
      resizeHandle.style.background = "transparent";
      resizeHandle.style.opacity = "1";
    });
    this.setupResizeHandle(doc, resizeHandle);
    this.panel.appendChild(resizeHandle);

    // Header - draggable
    const header = doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLElement;
    header.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid var(--fill-quinary, #ddd);
      flex-shrink: 0;
      cursor: grab;
      user-select: none;
    `;

    // Left side logo + title (draggable area)
    const headerLeft = doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLElement;
    headerLeft.style.cssText = "display: flex; align-items: center; gap: 10px; flex: 1;";
    headerLeft.innerHTML = `
      <img src="${logoIcon}" style="width: 24px; height: 24px; border-radius: 4px; pointer-events: none;" />
      <span style="font-weight: 600; font-size: 14px; color: var(--fill-primary, #333); pointer-events: none;">Zotero Agent</span>
    `;
    header.appendChild(headerLeft);

    // Right side button area
    const headerRight = doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLElement;
    headerRight.style.cssText = "display: flex; align-items: center; gap: 4px;";

    // New chat button
    const newChatBtn = doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLElement;
    newChatBtn.id = "agent-panel-new-chat";
    newChatBtn.title = "新对话";
    newChatBtn.style.cssText = `
      background: none;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 4px;
      color: var(--fill-secondary, #666);
      font-size: 14px;
      line-height: 1;
    `;
    newChatBtn.textContent = "＋";
    newChatBtn.addEventListener("mouseenter", () => { newChatBtn.style.background = "var(--fill-quinary, #eee)"; });
    newChatBtn.addEventListener("mouseleave", () => { newChatBtn.style.background = "none"; });
    newChatBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.startNewChat();
    });
    headerRight.appendChild(newChatBtn);

    // Close button - use div to simulate button, avoid Zotero security mechanism removing button
    const closeBtn = doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLElement;
    closeBtn.id = "agent-panel-close";
    closeBtn.title = "收起";
    closeBtn.style.cssText = `
      background: none;
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 4px;
      color: var(--fill-secondary, #666);
      font-size: 18px;
      line-height: 1;
    `;
    closeBtn.textContent = "×";
    closeBtn.addEventListener("mouseenter", () => { closeBtn.style.background = "var(--fill-quinary, #eee)"; });
    closeBtn.addEventListener("mouseleave", () => { closeBtn.style.background = "none"; });
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.collapse();
    });
    headerRight.appendChild(closeBtn);
    header.appendChild(headerRight);

    // Header drag functionality
    this.setupHeaderDrag(doc, header);

    this.panel.appendChild(header);

    // Messages area
    this.messagesContainer = doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLElement;
    this.messagesContainer.id = "agent-side-panel-messages";
    this.messagesContainer.setAttribute("tabindex", "0"); // Allow focus
    this.messagesContainer.style.cssText = `
      flex: 1;
      overflow-y: auto;
      padding: 12px 16px;
      min-height: 0;
      user-select: text;
      cursor: text;
      outline: none;
    `;

    // Manually handle copy event (Zotero XUL environment clipboard compatibility)
    this.messagesContainer.addEventListener("keydown", (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "c") {
        const selection = doc.getSelection();
        if (selection && selection.toString().trim()) {
          e.preventDefault();
          const text = selection.toString();
          new ztoolkit.Clipboard().addText(text, "text/unicode").copy();
          Logger.debug("SidePanel", "Copied to clipboard", `${text.length} chars`);
        }
      }
    });

    this.renderWelcomeMessage();
    this.panel.appendChild(this.messagesContainer);

    // Input area (contains command menu)
    const inputWrapper = doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLElement;
    inputWrapper.id = "agent-input-wrapper";
    inputWrapper.style.cssText = `
      padding: 12px 16px;
      border-top: 1px solid var(--fill-quinary, #ddd);
      flex-shrink: 0;
      position: relative;
    `;

    // Command suggestion menu
    const commandMenu = doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLElement;
    commandMenu.id = "agent-command-menu";
    commandMenu.style.cssText = `
      display: none;
      position: absolute;
      bottom: 100%;
      left: 16px;
      right: 16px;
      background: var(--material-background, #fff);
      border: 1px solid var(--fill-quinary, #ddd);
      border-radius: 8px;
      box-shadow: 0 -4px 12px rgba(0,0,0,0.1);
      max-height: 200px;
      overflow-y: auto;
      z-index: 100;
    `;
    inputWrapper.appendChild(commandMenu);

    const input = doc.createElementNS("http://www.w3.org/1999/xhtml", "input") as HTMLInputElement;
    input.id = "agent-side-panel-input";
    input.type = "text";
    input.placeholder = "输入问题，按回车发送...";
    input.style.cssText = `
      width: 100%;
      padding: 10px 12px;
      border: 1px solid var(--fill-quinary, #ddd);
      border-radius: 8px;
      font-size: 13px;
      box-sizing: border-box;
      background: var(--material-background, #fff);
      color: var(--fill-primary, #333);
      outline: none;
    `;

    input.addEventListener("keydown", (e) => this.handleInputKeydown(e as KeyboardEvent, input));
    input.addEventListener("input", () => this.handleInputChange(input, commandMenu));
    input.addEventListener("focus", () => { input.style.borderColor = "#3B82F6"; });
    input.addEventListener("blur", () => {
      input.style.borderColor = "var(--fill-quinary, #ddd)";
      // Delay hiding menu to allow click event to trigger
      setTimeout(() => { commandMenu.style.display = "none"; }, 150);
    });

    inputWrapper.appendChild(input);
    this.panel.appendChild(inputWrapper);
  }

  /**
   * Set up header drag functionality
   */
  /**
   * Set up left edge resize (adjust width)
   */
  private setupResizeHandle(doc: Document, handle: HTMLElement) {
    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    handle.addEventListener("mousedown", (e: MouseEvent) => {
      isResizing = true;
      startX = e.clientX;
      startWidth = this.panel?.offsetWidth || SidePanel.defaultWidth;
      e.preventDefault();
      e.stopPropagation();
    });

    doc.addEventListener("mousemove", (e: MouseEvent) => {
      if (!isResizing || !this.panel) return;

      const deltaX = startX - e.clientX;
      const win = ztoolkit.getGlobal("window");

      // Calculate new width, limit between 250-600px
      let newWidth = startWidth + deltaX;
      newWidth = Math.max(250, Math.min(600, newWidth));

      this.panel.style.width = `${newWidth}px`;
    });

    doc.addEventListener("mouseup", () => {
      if (isResizing) {
        isResizing = false;
        this.saveWidth();
      }
    });
  }

  /**
   * Save panel width
   */
  private saveWidth() {
    if (!this.panel) return;
    const width = this.panel.offsetWidth;
    try {
      Zotero.Prefs.set("extensions.zoteroagent.panelWidth", width);
    } catch (e) {
      // ignore
    }
  }

  /**
   * Get saved width
   */
  private getSavedWidth(): number {
    try {
      const saved = Zotero.Prefs.get("extensions.zoteroagent.panelWidth") as number;
      if (saved && saved >= 250 && saved <= 600) {
        return saved;
      }
    } catch (e) {
      // ignore
    }
    return SidePanel.defaultWidth;
  }

  private setupHeaderDrag(doc: Document, header: HTMLElement) {
    let isDragging = false;
    let startX = 0, startY = 0;
    let startRight = 0, startTop = 0;

    header.addEventListener("mousedown", (e: MouseEvent) => {
      // Ignore button clicks
      if ((e.target as HTMLElement).closest("#agent-panel-close, #agent-panel-new-chat")) return;

      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      startRight = parseInt(this.panel!.style.right) || 0;
      startTop = parseInt(this.panel!.style.top) || 0;
      header.style.cursor = "grabbing";
      e.preventDefault();
    });

    doc.addEventListener("mousemove", (e: MouseEvent) => {
      if (!isDragging || !this.panel) return;

      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      const win = ztoolkit.getGlobal("window");
      let newRight = startRight - deltaX;
      let newTop = startTop + deltaY;

      // Boundary limits
      const panelWidth = this.panel.offsetWidth;
      const panelHeight = this.panel.offsetHeight;
      newRight = Math.max(0, Math.min(win.innerWidth - panelWidth, newRight));
      newTop = Math.max(0, Math.min(win.innerHeight - panelHeight, newTop));

      this.panel.style.right = `${newRight}px`;
      this.panel.style.top = `${newTop}px`;
    });

    doc.addEventListener("mouseup", () => {
      if (isDragging) {
        isDragging = false;
        header.style.cursor = "grab";

        // Save panel position
        this.savePanelPosition();
      }
    });
  }

  /**
   * Save panel position
   */
  private savePanelPosition() {
    if (!this.panel) return;
    const pos = {
      right: parseInt(this.panel.style.right) || 0,
      top: parseInt(this.panel.style.top) || 0,
    };
    try {
      Zotero.Prefs.set("extensions.zoteroagent.panelPos", JSON.stringify(pos));
    } catch (e) {
      // ignore
    }
  }

  /**
   * Get saved panel position
   */
  private getSavedPanelPosition(): { right: number; top: number } {
    try {
      const saved = Zotero.Prefs.get("extensions.zoteroagent.panelPos") as string;
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {
      // ignore
    }
    return { right: 0, top: 0 };
  }

  /**
   * Start new chat
   */
  private startNewChat() {
    // Clear chat history
    SidePanel.chatHistory = [];
    // Reset tool registry (will clear arXiv search results)
    SidePanel.toolRegistry = null;

    // Re-render welcome message
    this.renderWelcomeMessage();

    Logger.info("SidePanel", "Started new chat");
  }

  /**
   * Expand panel
   */
  expand() {
    if (!this.panel || !this.toggleBtn) return;

    this.isCollapsed = false;
    this.panel.style.display = "flex";
    this.toggleBtn.style.display = "none";

    // Restore chat history
    this.restoreChatHistory();

    // Focus input box
    setTimeout(() => {
      const input = this.panel?.querySelector("#agent-side-panel-input") as HTMLInputElement;
      input?.focus();
    }, 100);

    Logger.info("SidePanel", "Expanded");
  }

  /**
   * Collapse panel
   */
  collapse() {
    if (!this.panel || !this.toggleBtn) return;

    this.isCollapsed = true;
    this.panel.style.display = "none";
    this.toggleBtn.style.display = "flex";

    Logger.info("SidePanel", "Collapsed");
  }

  /**
   * Toggle show/hide
   */
  toggle() {
    if (this.isCollapsed) {
      this.expand();
    } else {
      this.collapse();
    }
  }

  /**
   * Render welcome message
   */
  private renderWelcomeMessage() {
    if (!this.messagesContainer) return;

    this.messagesContainer.innerHTML = `
      <div style="color: var(--fill-secondary, #666); font-size: 13px; line-height: 1.6;">
        <p style="margin: 0 0 12px 0;">你好！我是 Zotero Agent。</p>
        <p style="margin: 0 0 8px 0;">我可以帮你：</p>
        <ul style="margin: 0; padding-left: 20px;">
          <li>总结论文要点</li>
          <li>解答研究问题</li>
          <li>在 arXiv 搜索论文</li>
        </ul>
      </div>
    `;
  }

  /**
   * Handle input
   */
  private async handleInputKeydown(e: KeyboardEvent, input: HTMLInputElement) {
    // Check if command menu is visible
    const commandMenu = this.panel?.querySelector("#agent-command-menu") as HTMLElement;
    const isMenuVisible = commandMenu && commandMenu.style.display === "block";
    const menuItems = commandMenu?.children || [];

    // If command menu is visible, prioritize menu navigation
    if (isMenuVisible && menuItems.length > 0) {
      if (e.key === "ArrowUp") {
        e.preventDefault();
        // Move selection up
        if (SidePanel.commandMenuIndex <= 0) {
          SidePanel.commandMenuIndex = menuItems.length - 1;
        } else {
          SidePanel.commandMenuIndex--;
        }
        this.updateCommandMenuSelection(commandMenu);
        return;
      }

      if (e.key === "ArrowDown") {
        e.preventDefault();
        // Move selection down
        if (SidePanel.commandMenuIndex >= menuItems.length - 1) {
          SidePanel.commandMenuIndex = 0;
        } else {
          SidePanel.commandMenuIndex++;
        }
        this.updateCommandMenuSelection(commandMenu);
        return;
      }

      if (e.key === "Enter" && SidePanel.commandMenuIndex >= 0) {
        e.preventDefault();
        // Fill in selected command
        const selectedItem = menuItems[SidePanel.commandMenuIndex] as HTMLElement;
        const cmdName = selectedItem?.querySelector("div")?.textContent?.trim();
        if (cmdName) {
          input.value = `${cmdName} `;
          commandMenu.style.display = "none";
          SidePanel.commandMenuIndex = -1;
          // Move cursor to end
          setTimeout(() => input.setSelectionRange(input.value.length, input.value.length), 0);
        }
        return;
      }

      if (e.key === "Escape") {
        e.preventDefault();
        commandMenu.style.display = "none";
        SidePanel.commandMenuIndex = -1;
        return;
      }
    }

    // Up/down arrows to switch input history (only when menu is not visible)
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (SidePanel.inputHistory.length === 0) return;

      // First time pressing up arrow, save current input
      if (SidePanel.inputHistoryIndex === -1) {
        SidePanel.currentInput = input.value;
      }

      // Move index up
      if (SidePanel.inputHistoryIndex < SidePanel.inputHistory.length - 1) {
        SidePanel.inputHistoryIndex++;
        input.value = SidePanel.inputHistory[SidePanel.inputHistory.length - 1 - SidePanel.inputHistoryIndex];
        // Move cursor to end
        setTimeout(() => input.setSelectionRange(input.value.length, input.value.length), 0);
      }
      return;
    }

    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (SidePanel.inputHistoryIndex === -1) return;

      // Move index down
      SidePanel.inputHistoryIndex--;
      if (SidePanel.inputHistoryIndex === -1) {
        // Restore current input
        input.value = SidePanel.currentInput;
      } else {
        input.value = SidePanel.inputHistory[SidePanel.inputHistory.length - 1 - SidePanel.inputHistoryIndex];
      }
      // Move cursor to end
      setTimeout(() => input.setSelectionRange(input.value.length, input.value.length), 0);
      return;
    }

    if (e.key !== "Enter" || e.shiftKey) return;

    // Block sending new message while waiting for response
    if (this.isProcessing) {
      Logger.debug("SidePanel", "Message blocked - still processing");
      return;
    }

    e.preventDefault();
    const question = input.value.trim();
    if (!question) return;

    // Save to input history
    if (SidePanel.inputHistory[SidePanel.inputHistory.length - 1] !== question) {
      SidePanel.inputHistory.push(question);
      // Limit history count
      if (SidePanel.inputHistory.length > 50) {
        SidePanel.inputHistory.shift();
      }
    }
    // Reset history index
    SidePanel.inputHistoryIndex = -1;
    SidePanel.currentInput = "";

    Logger.info("SidePanel", "User input", question);

    // Clear welcome message
    if (this.messagesContainer?.querySelector("ul")) {
      this.messagesContainer.innerHTML = "";
    }

    this.appendMessage(question, true);
    input.value = "";

    // Hide command menu
    this.hideCommandMenu();

    // Check if it's a slash command
    if (commandRegistry.isCommand(question)) {
      await this.handleCommand(question);
      return;
    }

    // Check LLM configuration
    const apiKey = getPref("llm.apiKey") as string;
    const apiBase = getPref("llm.apiBase") as string;
    const model = getPref("llm.model") as string;

    if (!apiKey || !apiBase || !model) {
      const missing: string[] = [];
      if (!apiKey) missing.push("API Key");
      if (!apiBase) missing.push("API Base");
      if (!model) missing.push("Model");

      this.appendMessage(`**LLM 未配置**

缺少: ${missing.join(", ")}

请使用以下命令配置：
\`/apikey <your-api-key>\`
\`/apibase <api-url>\`
\`/model <model-name>\`

或输入 \`/config\` 查看当前配置`, false);
      return;
    }

    // Set processing state, block sending new messages
    this.isProcessing = true;
    this.updateInputState(input, true);

    const loadingId = this.appendMessage("🤔 Analyzing intent...", false, true);

    try {
      // Build tool execution context
      const ZoteroPane = ztoolkit.getGlobal("ZoteroPane");
      const selectedItems = ZoteroPane?.getSelectedItems?.() || [];
      const currentItem = selectedItems.length > 0 ? selectedItems[0] : null;
      const metadata = currentItem ? PDFService.getItemMetadata(currentItem) : null;
      const selectedText = PDFService.getSelectedText() || undefined;

      const context: ToolContext = {
        currentItem,
        metadata,
        selectedText,
      };

      // Use ToolRegistry to process request
      const toolRegistry = SidePanel.getToolRegistry();

      // Streaming response state
      let hasStartedResponse = false;
      let responseId = "";
      let responseContentDiv: HTMLElement | null = null;

      const result = await toolRegistry.process(question, context, {
        onStatus: (status) => {
          this.updateLoadingMessage(loadingId, status);
        },
        onStream: (chunk, fullText) => {
          if (!hasStartedResponse) {
            hasStartedResponse = true;
            this.removeMessage(loadingId);
            responseId = this.appendMessage("", false);
            responseContentDiv = this.messagesContainer?.querySelector(`#${responseId} div:last-child`) as HTMLElement;
          }
          if (responseContentDiv) {
            responseContentDiv.textContent = fullText;
            if (this.messagesContainer) {
              this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
            }
          }
        },
      });

      // Handle non-streaming result
      if (!result.streaming) {
        this.removeMessage(loadingId);
        if (result.success) {
          this.appendMessage(result.message || "Done", false);
        } else {
          this.appendMessage(result.error || "Operation failed", false);
        }
      } else if (hasStartedResponse) {
        // Update streaming response to history
        const historyItem = SidePanel.chatHistory.find(h => h.id === responseId);
        if (historyItem && result.message) {
          historyItem.content = result.message;
        }
      }

    } catch (error: any) {
      Logger.error("SidePanel", "Error", error.message);
      this.removeMessage(loadingId);
      this.appendMessage(`错误: ${error.message}`, false);
    } finally {
      // Restore processing state
      this.isProcessing = false;
      this.updateInputState(input, false);
    }
  }

  /**
   * Handle slash command
   */
  private async handleCommand(input: string) {
    const result = await commandRegistry.execute(input);

    if (!result) {
      this.appendMessage("Command execution failed", false);
      return;
    }

    // Special handling: clear chat
    if (result.message === "__CLEAR_CHAT__") {
      this.startNewChat();
      return;
    }

    // Display command result
    this.appendMessage(result.message, false);

    // If LLM Service needs to be refreshed
    if (result.refreshLLM) {
      SidePanel.llmService = null;
      SidePanel.toolRegistry = null;
      Logger.info("SidePanel", "LLM Service refreshed due to config change");
    }
  }

  /**
   * Handle input change, show command menu
   */
  private handleInputChange(input: HTMLInputElement, menu: HTMLElement) {
    const value = input.value;

    // Reset menu selection index
    SidePanel.commandMenuIndex = -1;

    // Only show menu when input starts with /
    if (!value.startsWith("/")) {
      menu.style.display = "none";
      return;
    }

    // Get command part of input (remove /)
    const cmdInput = value.substring(1).toLowerCase().split(" ")[0];

    // Filter matching commands
    const allCommands = commandRegistry.getAll();
    const filteredCommands = allCommands.filter(cmd =>
      cmd.name.toLowerCase().includes(cmdInput)
    );

    if (filteredCommands.length === 0) {
      menu.style.display = "none";
      return;
    }

    // Render menu
    const doc = menu.ownerDocument;
    if (!doc) return;

    menu.innerHTML = "";

    filteredCommands.forEach((cmd, index) => {
      const item = doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLElement;
      item.setAttribute("data-index", String(index));
      item.style.cssText = `
        padding: 8px 12px;
        cursor: pointer;
        border-bottom: 1px solid var(--fill-quinary, #eee);
      `;
      item.innerHTML = `
        <div style="font-weight: 500; font-size: 13px; color: var(--fill-primary, #333);">/${cmd.name}</div>
        <div style="font-size: 11px; color: var(--fill-secondary, #666); margin-top: 2px;">${cmd.description}</div>
      `;

      item.addEventListener("mouseenter", () => {
        // Update selection index and refresh styles
        SidePanel.commandMenuIndex = index;
        this.updateCommandMenuSelection(menu);
      });

      item.addEventListener("click", () => {
        input.value = `/${cmd.name} `;
        menu.style.display = "none";
        SidePanel.commandMenuIndex = -1;
        input.focus();
      });

      menu.appendChild(item);
    });

    menu.style.display = "block";
  }

  /**
   * Update command menu selection state
   */
  private updateCommandMenuSelection(menu: HTMLElement) {
    const items = menu.children;
    for (let i = 0; i < items.length; i++) {
      const item = items[i] as HTMLElement;
      if (i === SidePanel.commandMenuIndex) {
        item.style.background = "var(--fill-quinary, #f0f0f0)";
        // Scroll to selected item
        item.scrollIntoView({ block: "nearest" });
      } else {
        item.style.background = "none";
      }
    }
  }

  /**
   * Hide command menu
   */
  private hideCommandMenu() {
    const menu = this.panel?.querySelector("#agent-command-menu") as HTMLElement;
    if (menu) {
      menu.style.display = "none";
    }
    SidePanel.commandMenuIndex = -1;
  }

  /**
   * Append message
   */
  private appendMessage(text: string, isUser: boolean, isLoading = false): string {
    const msgId = `msg-${Date.now()}`;
    if (!this.messagesContainer) return msgId;

    if (!isLoading) {
      SidePanel.chatHistory.push({ role: isUser ? "user" : "assistant", content: text, isUser, id: msgId });
    }

    const doc = this.messagesContainer.ownerDocument;
    if (!doc) return msgId;

    const msgDiv = doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLElement;
    msgDiv.id = msgId;
    msgDiv.style.cssText = `
      padding: 10px 0;
      font-size: 13px;
      line-height: 1.6;
      border-bottom: 1px solid var(--fill-quinary, #eee);
      ${isLoading ? "opacity: 0.6;" : ""}
    `;

    const label = doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLElement;
    label.style.cssText = `font-size: 12px; font-weight: 600; margin-bottom: 4px; color: ${isUser ? "#3B82F6" : "#F59E0B"};`;
    label.textContent = isUser ? "You" : "Agent";
    msgDiv.appendChild(label);

    const content = doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLElement;
    content.style.cssText = `color: var(--fill-primary, #333); white-space: pre-wrap; word-wrap: break-word; user-select: text; cursor: text; ${isLoading ? "font-style: italic;" : ""}`;
    content.textContent = text;
    msgDiv.appendChild(content);

    this.messagesContainer.appendChild(msgDiv);
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;

    return msgId;
  }

  private removeMessage(msgId: string) {
    this.messagesContainer?.querySelector(`#${msgId}`)?.remove();
  }

  /**
   * Update loading message text
   */
  private updateLoadingMessage(msgId: string, text: string) {
    const msgDiv = this.messagesContainer?.querySelector(`#${msgId}`);
    if (msgDiv) {
      const contentDiv = msgDiv.querySelector("div:last-child");
      if (contentDiv) {
        contentDiv.textContent = text;
      }
    }
  }

  /**
   * Update input box state (disable/enable)
   */
  private updateInputState(input: HTMLInputElement, disabled: boolean) {
    if (disabled) {
      input.disabled = true;
      input.placeholder = "等待回复中...";
      input.style.opacity = "0.6";
    } else {
      input.disabled = false;
      input.placeholder = "输入问题，按回车发送...";
      input.style.opacity = "1";
    }
  }

  private restoreChatHistory() {
    if (!this.messagesContainer || SidePanel.chatHistory.length === 0) return;

    const doc = this.messagesContainer.ownerDocument;
    if (!doc) return;

    this.messagesContainer.innerHTML = "";
    for (const msg of SidePanel.chatHistory) {
      const msgDiv = doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLElement;
      msgDiv.id = msg.id;
      msgDiv.style.cssText = `padding: 10px 0; font-size: 13px; line-height: 1.6; border-bottom: 1px solid var(--fill-quinary, #eee);`;

      const label = doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLElement;
      label.style.cssText = `font-size: 12px; font-weight: 600; margin-bottom: 4px; color: ${msg.isUser ? "#3B82F6" : "#F59E0B"};`;
      label.textContent = msg.isUser ? "You" : "Agent";
      msgDiv.appendChild(label);

      const content = doc.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLElement;
      content.style.cssText = `color: var(--fill-primary, #333); white-space: pre-wrap; word-wrap: break-word; user-select: text; cursor: text;`;
      content.textContent = msg.content;
      msgDiv.appendChild(content);

      this.messagesContainer.appendChild(msgDiv);
    }
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }

  destroy() {
    const doc = ztoolkit.getGlobal("document");
    doc.querySelector(`#${SidePanel.panelId}`)?.remove();
    doc.querySelector(`#${SidePanel.toggleBtnId}`)?.remove();
    this.panel = null;
    this.toggleBtn = null;
    this.messagesContainer = null;
  }
}
