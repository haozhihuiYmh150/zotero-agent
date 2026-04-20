/**
 * Tool Registry - Manages all available tools
 *
 * Responsibilities:
 * 1. Register and manage tools
 * 2. Intent analysis (call LLM to determine user intent)
 * 3. Dispatch execution to corresponding tool based on intent
 *
 * Future upgrade points:
 * - Pass tool definitions to LLM for Function Calling
 * - LLM autonomously selects tools and parameters
 */

import { Tool, ToolContext, ToolParams, ToolResult, StatusCallback, StreamCallback } from "./BaseTool";
import { ArxivSearchTool, ArxivDownloadTool } from "./ArxivTools";
import { SummarizeTool } from "./SummarizeTool";
import { PaperQATool, GeneralQATool } from "./QATools";
import { LLMService } from "../services/LLMService";
import { Logger } from "../utils/logger";

/**
 * Intent analysis result
 */
export interface IntentResult {
  /** Matched tool name */
  toolName: string;
  /** Extracted parameters */
  params: Record<string, any>;
  /** Analysis reason */
  reason?: string;
  /** Confidence score (0-1) */
  confidence?: number;
}

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private llmService: LLMService;

  constructor(llmService: LLMService) {
    this.llmService = llmService;
    this.registerDefaultTools();
  }

  /**
   * Register default tools
   */
  private registerDefaultTools() {
    this.register(new ArxivSearchTool());
    this.register(new ArxivDownloadTool());
    this.register(new SummarizeTool(this.llmService));
    this.register(new PaperQATool(this.llmService));
    this.register(new GeneralQATool(this.llmService));

    Logger.info("ToolRegistry", "Default tools registered", {
      count: this.tools.size,
      tools: Array.from(this.tools.keys()),
    });
  }

  /**
   * Register tool
   */
  register(tool: Tool) {
    this.tools.set(tool.name, tool);
  }

  /**
   * Get tool
   */
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all tools
   */
  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Analyze user intent, return the tool and parameters to use
   */
  async analyzeIntent(userInput: string, context: ToolContext): Promise<IntentResult> {
    // 1. Check if it's a download command (special handling, no LLM needed)
    const downloadMatch = userInput.match(/下载\s*(?:第?\s*)?(\d+)/);
    if (downloadMatch) {
      return {
        toolName: "arxiv_download",
        params: { index: downloadMatch[1] },
        reason: "User input contains download instruction",
        confidence: 1.0,
      };
    }

    // 2. Quick match: summarize-related requests go to summarize (tool handles selected text internally)
    if (/总结|概括|归纳|摘要/.test(userInput) && !/搜索|查找|找/.test(userInput)) {
      // Check if it's "总结 xxx 论文" (wants to find specific paper)
      const searchMatch = userInput.match(/总结\s*[《"']?(.{5,})[》"']?/);
      if (searchMatch && !context.selectedText && !/这篇|当前|选中/.test(userInput)) {
        // Might want to search for specific paper
        return {
          toolName: "arxiv_search",
          params: { keywords: searchMatch[1].trim() },
          reason: "User wants to summarize specific paper, search first",
          confidence: 0.8,
        };
      }
      // Otherwise summarize directly (tool auto-detects whether to summarize selected text or full paper)
      return {
        toolName: "summarize",
        params: {},
        reason: context.selectedText ? "Summarize selected text" : "Summarize full paper",
        confidence: 0.9,
      };
    }

    // 3. Build tool descriptions
    const toolDescriptions = this.getAll()
      .filter((t) => t.name !== "arxiv_download") // Download tool already handled specially
      .map((t) => `- ${t.name}: ${t.description}`)
      .join("\n");

    // 4. Build context information
    let contextInfo = context.metadata
      ? `当前选中的论文: "${context.metadata.title}"`
      : "当前没有选中任何论文";
    if (context.selectedText) {
      contextInfo += `\nPDF 中有选中文本 (${context.selectedText.length} 字符)`;
    }

    // 5. Call LLM to analyze intent
    const prompt = `分析用户意图，选择合适的工具。

${contextInfo}

可用工具：
${toolDescriptions}

用户输入: "${userInput}"

判断规则：
1. 如果用户想搜索/查找论文 → arxiv_search（提取英文关键词）
2. 如果用户说"总结"/"总结选中"/"总结这段" → summarize（工具会自动处理选中文本）
3. 如果用户说"总结 xxx论文"（想找特定论文） → arxiv_search（先搜索那篇论文）
4. 如果用户问题关于当前论文（这篇/本文/该论文） → paper_qa
5. 其他问题 → general_qa

示例：
- "总结" / "总结选中" / "总结这段" → summarize
- "总结 attention is all you need" → arxiv_search, keywords: "attention is all you need"
- "搜索 gpu 优化" → arxiv_search, keywords: "gpu optimization"
- "这篇论文用了什么方法" → paper_qa, question: "这篇论文用了什么方法"
- "什么是 transformer" → general_qa, question: "什么是 transformer"

返回 JSON（不要其他内容）：
{"tool": "工具名", "params": {"参数名": "值"}, "reason": "判断原因"}`;

    try {
      const result = await this.llmService.chat([
        { role: "system", content: "你是意图分析助手。只返回 JSON。" },
        { role: "user", content: prompt },
      ]);

      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        // Map old format to new format
        let toolName = parsed.tool || parsed.action;
        if (toolName === "search_arxiv") toolName = "arxiv_search";
        if (toolName === "summarize_current") toolName = "summarize";
        if (toolName === "qa_current") toolName = "paper_qa";
        if (toolName === "qa_general") toolName = "general_qa";

        // Build parameters
        const params: Record<string, any> = parsed.params || {};
        if (parsed.keywords) params.keywords = parsed.keywords;
        if (!params.question) params.question = userInput;

        Logger.info("ToolRegistry", "Intent analyzed", {
          tool: toolName,
          params,
          reason: parsed.reason,
        });

        return {
          toolName,
          params,
          reason: parsed.reason,
          confidence: 0.9,
        };
      }
    } catch (e: any) {
      Logger.warn("ToolRegistry", "LLM intent analysis failed", e.message);
    }

    // 5. Fallback: simple keyword matching
    return this.fallbackIntentAnalysis(userInput, context);
  }

  /**
   * Fallback intent analysis (not dependent on LLM)
   */
  private fallbackIntentAnalysis(userInput: string, context: ToolContext): IntentResult {
    // Search
    if (/搜索|查找|找.*论文|arxiv/i.test(userInput)) {
      return {
        toolName: "arxiv_search",
        params: { keywords: userInput.replace(/搜索|查找|找|论文|arxiv/gi, "").trim() },
        reason: "Keyword match: search",
        confidence: 0.7,
      };
    }

    // Summarize current paper
    if (/^总结$|总结这篇|总结当前/.test(userInput)) {
      return {
        toolName: "summarize",
        params: {},
        reason: "Keyword match: summarize current",
        confidence: 0.8,
      };
    }

    // Questions about current paper
    if (context.metadata && /这篇|本文|该论文|论文.*方法|论文.*结论/.test(userInput)) {
      return {
        toolName: "paper_qa",
        params: { question: userInput },
        reason: "Keyword match: paper-related question",
        confidence: 0.7,
      };
    }

    // Default general QA
    return {
      toolName: "general_qa",
      params: { question: userInput },
      reason: "Default: general QA",
      confidence: 0.5,
    };
  }

  /**
   * Execute tool
   */
  async execute(
    toolName: string,
    params: ToolParams,
    context: ToolContext,
    callbacks: { onStatus?: StatusCallback; onStream?: StreamCallback }
  ): Promise<ToolResult> {
    const tool = this.get(toolName);

    if (!tool) {
      Logger.error("ToolRegistry", "Tool not found", toolName);
      return {
        success: false,
        error: `未知的工具: ${toolName}`,
      };
    }

    Logger.info("ToolRegistry", "Executing tool", { tool: toolName, params });

    return tool.execute(params, context, callbacks);
  }

  /**
   * One-stop processing: intent analysis + execution
   */
  async process(
    userInput: string,
    context: ToolContext,
    callbacks: { onStatus?: StatusCallback; onStream?: StreamCallback }
  ): Promise<ToolResult> {
    // 1. Analyze intent
    callbacks.onStatus?.("🤔 分析意图...");
    const intent = await this.analyzeIntent(userInput, context);

    // 2. Execute tool
    return this.execute(
      intent.toolName,
      { userInput, ...intent.params },
      context,
      callbacks
    );
  }

  /**
   * Generate JSON Schema for all tools (for Function Calling)
   */
  generateFunctionCallingSchema(): object[] {
    return this.getAll().map((tool) => {
      if ("toJSONSchema" in tool && typeof tool.toJSONSchema === "function") {
        return tool.toJSONSchema();
      }
      return {
        name: tool.name,
        description: tool.description,
        parameters: { type: "object", properties: {} },
      };
    });
  }
}
