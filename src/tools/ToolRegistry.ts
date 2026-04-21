/**
 * Tool Registry - Manages all available tools
 *
 * Responsibilities:
 * 1. Register and manage tools
 * 2. Intent analysis with Harness Engineering (hard constraints + LLM)
 * 3. Dispatch execution to corresponding tool based on intent
 */

import {
  Tool,
  ToolContext,
  ToolParams,
  ToolResult,
  StatusCallback,
  StreamCallback,
} from "./BaseTool";
import { ArxivSearchTool, ArxivDownloadTool } from "./ArxivTools";
import { SummarizeTool } from "./SummarizeTool";
import { PaperQATool, GeneralQATool } from "./QATools";
import { LLMService } from "../services/LLMService";
import { Logger } from "../utils/logger";
import { IntentAnalyzer, IntentResult } from "./IntentAnalyzer";

// Re-export IntentResult for backward compatibility
export type { IntentResult };

export class ToolRegistry {
  private tools: Map<string, Tool> = new Map();
  private llmService: LLMService;
  private intentAnalyzer: IntentAnalyzer;

  constructor(llmService: LLMService) {
    this.llmService = llmService;
    this.intentAnalyzer = new IntentAnalyzer(llmService);
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

    // Update IntentAnalyzer with tool descriptions
    const toolDescriptions = this.getAll()
      .filter((t) => t.name !== "arxiv_download")
      .map((t) => `- ${t.name}: ${t.description}`)
      .join("\n");
    this.intentAnalyzer.setToolDescriptions(toolDescriptions);
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
   * Analyze user intent (delegates to IntentAnalyzer with Harness + LLM)
   */
  async analyzeIntent(
    userInput: string,
    context: ToolContext,
  ): Promise<IntentResult> {
    return this.intentAnalyzer.analyze(userInput, context, context.chatHistory);
  }

  /**
   * Execute tool
   */
  async execute(
    toolName: string,
    params: ToolParams,
    context: ToolContext,
    callbacks: { onStatus?: StatusCallback; onStream?: StreamCallback },
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
    callbacks: { onStatus?: StatusCallback; onStream?: StreamCallback },
  ): Promise<ToolResult> {
    // 1. Analyze intent
    callbacks.onStatus?.("🤔 分析意图...");
    const intent = await this.analyzeIntent(userInput, context);

    // 2. Execute tool
    return this.execute(
      intent.toolName,
      { userInput, ...intent.params },
      context,
      callbacks,
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
