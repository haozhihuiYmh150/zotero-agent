/**
 * Intent Analyzer with Harness Engineering
 *
 * Architecture:
 * 1. Hard Constraints (Harness) - explicit rules, bypass LLM
 * 2. LLM Analysis - handle ambiguous intents
 * 3. Confidence Threshold - ask user when uncertain
 */

import { ToolContext } from "./BaseTool";
import { LLMService, ChatMessage } from "../services/LLMService";
import { Logger } from "../utils/logger";

export interface IntentResult {
  toolName: string;
  params: Record<string, any>;
  reason?: string;
  confidence: number;
  source: "harness" | "llm" | "fallback";
}

/**
 * Hard constraint rule definition
 */
interface HarnessRule {
  name: string;
  /** Pattern to match (if matched, rule applies) */
  match?: RegExp;
  /** Pattern to exclude (if matched, rule does NOT apply) */
  exclude?: RegExp;
  /** Context condition */
  contextCheck?: (ctx: ToolContext) => boolean;
  /** Target tool */
  tool: string;
  /** Parameter extractor */
  extractParams?: (input: string, ctx: ToolContext) => Record<string, any>;
  /** Confidence level */
  confidence: number;
  /** Rule priority (higher = checked first) */
  priority: number;
}

/**
 * Confidence threshold for user confirmation
 */
const CONFIDENCE_THRESHOLD = 0.6;

/**
 * Hard constraint rules (Harness)
 * These rules are checked BEFORE LLM analysis
 * Order by priority (higher first)
 */
const HARNESS_RULES: HarnessRule[] = [
  // === Priority 100: Explicit commands ===
  {
    name: "download_command",
    match: /下载\s*(?:第?\s*)?(\d+)/,
    tool: "arxiv_download",
    extractParams: (input) => {
      const m = input.match(/下载\s*(?:第?\s*)?(\d+)/);
      return { index: m?.[1] };
    },
    confidence: 1.0,
    priority: 100,
  },

  // === Priority 90: Historical conversation questions ===
  {
    name: "history_question",
    match: /之前|刚才|刚刚|上次|前面|返回了几|多少篇|几篇|你.*说/,
    exclude: /去搜索|帮我搜|搜一下|查一下|找一下/,
    tool: "general_qa",
    extractParams: (input) => ({ question: input }),
    confidence: 0.95,
    priority: 90,
  },

  // === Priority 80: Summarize with selected text ===
  {
    name: "summarize_selected",
    match: /总结|概括|归纳|摘要/,
    exclude: /搜索|查找|找/,
    contextCheck: (ctx) => !!ctx.selectedText && ctx.selectedText.length > 0,
    tool: "summarize",
    extractParams: () => ({}),
    confidence: 0.95,
    priority: 80,
  },

  // === Priority 70: Summarize current paper ===
  {
    name: "summarize_current",
    match: /^总结$|总结这篇|总结当前|总结选中/,
    contextCheck: (ctx) => ctx.selectedItems.length > 0,
    tool: "summarize",
    extractParams: () => ({}),
    confidence: 0.9,
    priority: 70,
  },
];

export class IntentAnalyzer {
  private llmService: LLMService;
  private toolDescriptions: string = "";

  constructor(llmService: LLMService) {
    this.llmService = llmService;
  }

  /**
   * Set tool descriptions for LLM context
   */
  setToolDescriptions(descriptions: string) {
    this.toolDescriptions = descriptions;
  }

  /**
   * Main entry: analyze user intent
   */
  async analyze(
    userInput: string,
    context: ToolContext,
    chatHistory?: ChatMessage[],
  ): Promise<IntentResult> {
    Logger.info("IntentAnalyzer", "=== Intent Analysis START ===", {
      input: userInput.substring(0, 50),
      hasSelectedText: !!context.selectedText,
      selectedItems: context.selectedItems.length,
      hasHistory: !!chatHistory?.length,
    });

    // Phase 1: Check hard constraints (Harness)
    const harnessResult = this.checkHarnessRules(userInput, context);
    if (harnessResult) {
      Logger.info("IntentAnalyzer", "Harness rule matched", {
        rule: harnessResult.reason,
        tool: harnessResult.toolName,
        confidence: harnessResult.confidence,
      });
      return harnessResult;
    }

    // Phase 2: LLM analysis
    const llmResult = await this.llmAnalyze(userInput, context, chatHistory);

    // Phase 3: Check confidence threshold
    if (llmResult.confidence < CONFIDENCE_THRESHOLD) {
      Logger.warn("IntentAnalyzer", "Low confidence, may need user confirmation", {
        tool: llmResult.toolName,
        confidence: llmResult.confidence,
      });
      // TODO: In future, can trigger user confirmation dialog
    }

    Logger.info("IntentAnalyzer", "=== Intent Analysis END ===", {
      tool: llmResult.toolName,
      confidence: llmResult.confidence,
      source: llmResult.source,
    });

    return llmResult;
  }

  /**
   * Phase 1: Check hard constraint rules
   */
  private checkHarnessRules(
    userInput: string,
    context: ToolContext,
  ): IntentResult | null {
    // Sort by priority (descending)
    const sortedRules = [...HARNESS_RULES].sort((a, b) => b.priority - a.priority);

    for (const rule of sortedRules) {
      // Check match pattern
      if (rule.match && !rule.match.test(userInput)) {
        continue;
      }

      // Check exclude pattern
      if (rule.exclude && rule.exclude.test(userInput)) {
        continue;
      }

      // Check context condition
      if (rule.contextCheck && !rule.contextCheck(context)) {
        continue;
      }

      // Rule matched, extract parameters
      const params = rule.extractParams
        ? rule.extractParams(userInput, context)
        : { question: userInput };

      return {
        toolName: rule.tool,
        params,
        reason: `Harness rule: ${rule.name}`,
        confidence: rule.confidence,
        source: "harness",
      };
    }

    return null;
  }

  /**
   * Phase 2: LLM intent analysis
   */
  private async llmAnalyze(
    userInput: string,
    context: ToolContext,
    chatHistory?: ChatMessage[],
  ): Promise<IntentResult> {
    // Build context info
    let contextInfo = context.metadata
      ? `当前选中论文: "${context.metadata.title}"`
      : "当前没有选中论文";

    if (context.selectedText) {
      contextInfo += `\nPDF 中有选中文本 (${context.selectedText.length} 字符)`;
    }

    if (context.selectedItems.length > 1) {
      contextInfo += `\n共选中 ${context.selectedItems.length} 篇论文`;
    }

    // Build conversation history summary (for context awareness)
    let historySummary = "";
    if (chatHistory && chatHistory.length > 0) {
      const recentHistory = chatHistory.slice(-5);
      historySummary = "\n\n最近对话摘要:\n" + recentHistory
        .map((msg) => `- ${msg.role === "user" ? "用户" : "助手"}: ${msg.content.substring(0, 100)}...`)
        .join("\n");
    }

    const prompt = `分析用户意图，选择合适的工具。

${contextInfo}${historySummary}

可用工具：
${this.toolDescriptions}

用户输入: "${userInput}"

判断规则：
1. 如果用户问的是关于之前对话的问题（如"你刚才说什么"、"返回了几篇"） → general_qa
2. 如果用户想搜索/查找论文 → arxiv_search（提取英文关键词）
3. 如果用户说"总结"且有选中文本或论文 → summarize
4. 如果用户问题关于当前论文内容 → paper_qa
5. 其他通用问题 → general_qa

请仔细分析用户意图，特别注意区分：
- "搜索 xxx" = 去 arXiv 搜索新论文
- "你之前搜索了什么" = 询问历史对话

返回 JSON（不要其他内容）：
{"tool": "工具名", "params": {"参数名": "值"}, "reason": "判断原因", "confidence": 0.0-1.0}`;

    try {
      const result = await this.llmService.chat([
        {
          role: "system",
          content: "你是意图分析助手。只返回 JSON，不要其他内容。confidence 字段表示你对判断的确信程度（0-1）。",
        },
        { role: "user", content: prompt },
      ]);

      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        // Normalize tool name
        let toolName = parsed.tool || "general_qa";
        if (toolName === "search_arxiv") toolName = "arxiv_search";
        if (toolName === "summarize_current") toolName = "summarize";
        if (toolName === "qa_current") toolName = "paper_qa";
        if (toolName === "qa_general") toolName = "general_qa";

        const params: Record<string, any> = parsed.params || {};
        if (!params.question) params.question = userInput;

        return {
          toolName,
          params,
          reason: parsed.reason || "LLM analysis",
          confidence: parsed.confidence || 0.7,
          source: "llm",
        };
      }
    } catch (e: any) {
      Logger.warn("IntentAnalyzer", "LLM analysis failed", e.message);
    }

    // Fallback
    return this.fallbackAnalysis(userInput, context);
  }

  /**
   * Phase 3: Fallback analysis (when LLM fails)
   */
  private fallbackAnalysis(
    userInput: string,
    context: ToolContext,
  ): IntentResult {
    // Simple keyword matching as last resort
    if (/搜索|查找|找.*论文|arxiv/i.test(userInput)) {
      return {
        toolName: "arxiv_search",
        params: {
          keywords: userInput.replace(/搜索|查找|找|论文|arxiv/gi, "").trim(),
        },
        reason: "Fallback: search keywords detected",
        confidence: 0.5,
        source: "fallback",
      };
    }

    if (context.metadata && /这篇|本文|该论文/.test(userInput)) {
      return {
        toolName: "paper_qa",
        params: { question: userInput },
        reason: "Fallback: paper reference detected",
        confidence: 0.5,
        source: "fallback",
      };
    }

    return {
      toolName: "general_qa",
      params: { question: userInput },
      reason: "Fallback: default to general QA",
      confidence: 0.4,
      source: "fallback",
    };
  }
}
