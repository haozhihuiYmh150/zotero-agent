/**
 * Tool Use Registry - Standard Function Calling Architecture
 *
 * Flow:
 * 1. User input + tools → LLM decides to call tool or respond directly
 * 2. If tool called → execute tool, get result
 * 3. Tool result → LLM generates final response
 *
 * Key principle: Tools only return data, LLM handles all reasoning.
 */

import {
  Tool,
  ToolContext,
  ToolResult,
  StatusCallback,
  StreamCallback,
  ToolCallCallback,
} from "./BaseTool";
import { ArxivSearchTool, ArxivDownloadTool, ArxivBatchDownloadTool } from "./ArxivTools";
import { PubMedSearchTool, PubMedDownloadTool, PubMedBatchDownloadTool } from "./PubMedTools";
import { GetPaperContentTool, GetPaperAbstractsTool } from "./DataTools";
import {
  LLMService,
  ChatMessage as LLMChatMessage,
  ToolDefinition,
} from "../services/LLMService";
import { Logger } from "../utils/logger";

/** Max tool call iterations to prevent infinite loops */
const MAX_TOOL_ITERATIONS = 10;

export class ToolUseRegistry {
  private tools: Map<string, Tool> = new Map();
  private llmService: LLMService;

  constructor(llmService: LLMService) {
    this.llmService = llmService;
    this.registerDefaultTools();
  }

  private registerDefaultTools() {
    // Data tools (no LLM inside)
    this.register(new GetPaperContentTool());
    this.register(new GetPaperAbstractsTool());
    // arXiv tools
    this.register(new ArxivSearchTool());
    this.register(new ArxivDownloadTool());
    this.register(new ArxivBatchDownloadTool());
    // PubMed tools
    this.register(new PubMedSearchTool());
    this.register(new PubMedDownloadTool());
    this.register(new PubMedBatchDownloadTool());

    Logger.info("ToolUseRegistry", "Tools registered", {
      count: this.tools.size,
      tools: Array.from(this.tools.keys()),
    });
  }

  register(tool: Tool) {
    this.tools.set(tool.name, tool);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Generate OpenAI-compatible tool definitions
   */
  private getToolDefinitions(): ToolDefinition[] {
    return [
      {
        type: "function",
        function: {
          name: "get_paper_content",
          description:
            "Get content of paper(s). For papers just downloaded in chat history, specify arxiv_id or pmid. Otherwise reads currently selected papers.",
          parameters: {
            type: "object",
            properties: {
              arxiv_id: {
                type: "string",
                description:
                  "arXiv ID (e.g., '2211.15444'). Use for papers recently downloaded from arXiv.",
              },
              pmid: {
                type: "string",
                description:
                  "PubMed ID (e.g., '12345678'). Use for papers recently downloaded from PubMed.",
              },
            },
          },
        },
      },
      {
        type: "function",
        function: {
          name: "get_paper_abstracts",
          description:
            "Get abstracts of all selected papers. Use this when user wants to analyze or compare many papers.",
          parameters: {
            type: "object",
            properties: {},
          },
        },
      },
      {
        type: "function",
        function: {
          name: "arxiv_search",
          description:
            "Search papers on arXiv. Use when user wants to find/search new papers.",
          parameters: {
            type: "object",
            properties: {
              keywords: {
                type: "string",
                description: "Search keywords (English preferred)",
              },
            },
            required: ["keywords"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "arxiv_download",
          description:
            "Download a single paper from previous search results. Use when user says 'download N' or 'download the Nth paper'.",
          parameters: {
            type: "object",
            properties: {
              index: {
                type: "number",
                description: "Paper index from search results (1-based)",
              },
            },
            required: ["index"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "arxiv_download_batch",
          description:
            "Download multiple papers at once. PREFERRED over multiple arxiv_download calls. Use when user wants to download multiple papers (e.g., 'download first 3', 'download 1,2,5').",
          parameters: {
            type: "object",
            properties: {
              indices: {
                type: "string",
                description: "Comma-separated paper indices (e.g., '1,2,3' or '1,3,5')",
              },
            },
            required: ["indices"],
          },
        },
      },
      // PubMed tools
      {
        type: "function",
        function: {
          name: "pubmed_search",
          description:
            "Search papers on PubMed. Use when user wants to find biomedical/life science papers, or explicitly mentions PubMed.",
          parameters: {
            type: "object",
            properties: {
              keywords: {
                type: "string",
                description: "Search keywords (English preferred)",
              },
            },
            required: ["keywords"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "pubmed_download",
          description:
            "Download a single paper from PubMed search results. Downloads PDF if available in PMC, otherwise imports metadata only.",
          parameters: {
            type: "object",
            properties: {
              index: {
                type: "number",
                description: "Paper index from search results (1-based)",
              },
            },
            required: ["index"],
          },
        },
      },
      {
        type: "function",
        function: {
          name: "pubmed_download_batch",
          description:
            "Download multiple PubMed papers at once. PREFERRED over multiple pubmed_download calls.",
          parameters: {
            type: "object",
            properties: {
              indices: {
                type: "string",
                description: "Comma-separated paper indices (e.g., '1,2,3' or '1,3,5')",
              },
            },
            required: ["indices"],
          },
        },
      },
    ];
  }

  /**
   * Build system prompt with context
   */
  private buildSystemPrompt(context: ToolContext): string {
    let contextInfo = "";

    if (context.selectedItems.length > 0) {
      if (context.selectedItems.length === 1 && context.metadata) {
        contextInfo = `\n当前选中: "${context.metadata.title}"`;
        if (context.metadata.authors) contextInfo += ` by ${context.metadata.authors}`;
      } else {
        contextInfo = `\n当前选中 ${context.selectedItems.length} 篇论文`;
      }
    } else {
      contextInfo = "\n当前没有选中论文";
    }

    if (context.selectedText) {
      contextInfo += `\nPDF 中有选中文本 (${context.selectedText.length} 字符)`;
    }

    return `你是 Zotero Agent，学术研究助手。帮助用户管理和理解学术论文。
${contextInfo}

工具使用指南：
1. 用户询问当前论文内容（总结、方法、结论、细节等）→ 调用 get_paper_content
2. 用户要分析/对比多篇论文 → 调用 get_paper_abstracts 获取**已选中论文**的摘要
3. 用户要搜索新论文:
   - 物理、CS、数学、统计等 → arxiv_search
   - 生物医学、生命科学 → pubmed_search
   - 用户明确指定平台时，使用对应工具
4. 用户说"下载第N篇"（指搜索结果）→ 根据之前搜索的平台，调用对应的 download 工具
5. 用户的问题不需要论文内容（如闲聊、通用问题）→ 直接回答

⚠️ 上下文亲近度（优先级从高到低）：
1. **对话历史** - 如果论文在本次对话中刚刚下载过，从下载消息中提取 arXiv ID 或 PMID，调用 get_paper_content(arxiv_id="xxx") 或 get_paper_content(pmid="xxx")
2. **已选中论文** - 如果用户已选中论文，调用 get_paper_content() 不带参数
3. **需要用户选择** - 只有当对话历史和选中都没有时，才请用户选中

示例：
- 对话历史中有 "已下载 arXiv:2211.15444 - FSSD论文"，用户问"总结FSSD" → 调用 get_paper_content(arxiv_id="2211.15444")
- 对话历史中有 "PMID:12345678 - xxx论文"，用户问"总结这篇" → 调用 get_paper_content(pmid="12345678")
- 用户选中了论文，问"总结这篇" → 调用 get_paper_content() 不带参数
- 没有历史也没选中 → 请用户选中

用中文回答，格式保持统一协调。`;
  }

  /**
   * Build messages from chat history
   */
  private buildMessages(
    userInput: string,
    context: ToolContext,
  ): LLMChatMessage[] {
    const messages: LLMChatMessage[] = [
      { role: "system", content: this.buildSystemPrompt(context) },
    ];

    // Add chat history (full history, no limit - let LLM handle context)
    if (context.chatHistory && context.chatHistory.length > 0) {
      for (const msg of context.chatHistory) {
        messages.push({
          role: msg.isUser ? "user" : "assistant",
          content: msg.content,
        });
      }
    }

    // Add current user input
    messages.push({ role: "user", content: userInput });

    return messages;
  }

  /**
   * Log messages array for debugging (summarized)
   */
  private logMessages(tag: string, messages: LLMChatMessage[]) {
    const summary = messages.map((m, i) => {
      const contentPreview = m.content
        ? m.content.substring(0, 50) + (m.content.length > 50 ? "..." : "")
        : "(empty)";
      const toolInfo = m.tool_calls
        ? ` [tool_calls: ${m.tool_calls.map((t) => t.function.name).join(", ")}]`
        : "";
      const toolIdInfo = m.tool_call_id ? ` [tool_call_id: ${m.tool_call_id}]` : "";
      return `  ${i}: ${m.role}${toolInfo}${toolIdInfo}: ${contentPreview}`;
    });

    Logger.info("ToolUseRegistry", tag, {
      count: messages.length,
      messages: "\n" + summary.join("\n"),
    });
  }

  /**
   * Process user input with standard Function Calling flow
   */
  async process(
    userInput: string,
    context: ToolContext,
    callbacks: {
      onStatus?: StatusCallback;
      onStream?: StreamCallback;
      onToolCall?: ToolCallCallback;
    },
  ): Promise<ToolResult> {
    Logger.info("ToolUseRegistry", "========== PROCESS START ==========", {
      input: userInput,
      selectedItems: context.selectedItems.length,
      hasSelectedText: !!context.selectedText,
      historyLength: context.chatHistory?.length || 0,
    });

    const messages = this.buildMessages(userInput, context);
    const tools = this.getToolDefinitions();

    this.logMessages("Initial messages", messages);
    Logger.info("ToolUseRegistry", "Tools available", {
      tools: tools.map((t) => t.function.name),
    });

    try {
      let iteration = 0;

      while (iteration < MAX_TOOL_ITERATIONS) {
        iteration++;
        Logger.info("ToolUseRegistry", `===== Iteration ${iteration}/${MAX_TOOL_ITERATIONS} =====`, {
          messagesCount: messages.length,
          lastMessageRole: messages[messages.length - 1]?.role,
        });

        // Call LLM with tools and streaming
        callbacks.onStatus?.("🤔 思考中...");
        Logger.info("ToolUseRegistry", "Calling LLM with tools (streaming)...");
        const response = await this.llmService.chatWithToolsStream(
          messages,
          tools,
          callbacks.onStream,
        );

        Logger.info("ToolUseRegistry", "LLM response received", {
          hasContent: !!response.content,
          contentLength: response.content?.length || 0,
          hasToolCalls: !!response.tool_calls,
          toolCallsCount: response.tool_calls?.length || 0,
          toolNames: response.tool_calls?.map((t) => t.function.name) || [],
        });

        // Check if LLM wants to call tools
        if (response.tool_calls && response.tool_calls.length > 0) {
          // Process ALL tool calls in this response (supports batch operations)
          const toolResults: Array<{ id: string; content: string }> = [];

          for (const toolCall of response.tool_calls) {
            const toolName = toolCall.function.name;
            let toolArgs: Record<string, any> = {};

            try {
              toolArgs = JSON.parse(toolCall.function.arguments || "{}");
            } catch (e) {
              Logger.warn("ToolUseRegistry", "Failed to parse tool arguments", {
                args: toolCall.function.arguments,
              });
            }

            Logger.info("ToolUseRegistry", ">>> TOOL CALL <<<", {
              tool: toolName,
              args: toolArgs,
              toolCallId: toolCall.id,
            });

            // Execute the tool
            const tool = this.get(toolName);
            if (!tool) {
              Logger.error("ToolUseRegistry", "Unknown tool", { toolName });
              callbacks.onToolCall?.({
                id: toolCall.id,
                name: toolName,
                args: toolArgs,
                status: "error",
                error: `Unknown tool "${toolName}"`,
              });
              toolResults.push({
                id: toolCall.id,
                content: `Error: Unknown tool "${toolName}"`,
              });
              continue;
            }

            // Notify UI: tool call started (running)
            callbacks.onToolCall?.({
              id: toolCall.id,
              name: toolName,
              args: toolArgs,
              status: "running",
            });

            // Execute tool
            Logger.info("ToolUseRegistry", "Executing tool...", { toolName });
            const toolResult = await tool.execute(
              { userInput, ...toolArgs },
              context,
              { onStatus: callbacks.onStatus },
            );

            Logger.info("ToolUseRegistry", "Tool execution complete", {
              toolName,
              success: toolResult.success,
              hasMessage: !!toolResult.message,
              messageLength: toolResult.message?.length || 0,
              hasData: !!toolResult.data,
              error: toolResult.error,
            });

            // Prepare result content
            const toolResultContent = toolResult.success
              ? toolResult.message || toolResult.data?.content || "Success"
              : `Error: ${toolResult.error}`;

            // Notify UI: tool call completed
            callbacks.onToolCall?.({
              id: toolCall.id,
              name: toolName,
              args: toolArgs,
              status: toolResult.success ? "completed" : "error",
              result: toolResult.success
                ? (toolResultContent.length > 100
                    ? toolResultContent.substring(0, 100) + "..."
                    : toolResultContent)
                : undefined,
              error: toolResult.success ? undefined : toolResult.error,
            });

            toolResults.push({
              id: toolCall.id,
              content: toolResultContent,
            });
          }

          // Add assistant message with all tool calls
          messages.push({
            role: "assistant",
            content: "",
            tool_calls: response.tool_calls,
          });

          // Add all tool results
          for (const result of toolResults) {
            messages.push({
              role: "tool",
              content: result.content,
              tool_call_id: result.id,
            });
          }

          Logger.info("ToolUseRegistry", `Iteration ${iteration} completed: executed ${toolResults.length} tool(s)`, {
            tools: response.tool_calls?.map((t) => t.function.name) || [],
            results: toolResults.map((r) => ({ id: r.id, success: !r.content.startsWith("Error") })),
          });

          this.logMessages("Messages after tool calls", messages);

          // Continue loop - LLM will generate response based on tool results
          callbacks.onStatus?.("📝 生成回复中...");
          continue;
        }

        // No tool call - LLM is ready to respond (already streamed via callback)
        if (response.content) {
          Logger.info("ToolUseRegistry", `Iteration ${iteration} completed: direct response`, {
            contentLength: response.content.length,
          });

          Logger.info("ToolUseRegistry", `========== PROCESS END (success, ${iteration} iterations) ==========`);
          return {
            success: true,
            message: response.content,
            streaming: true,
          };
        }

        // No content and no tool calls - unexpected
        Logger.warn("ToolUseRegistry", `Iteration ${iteration}: empty response (no content, no tool_calls)`);
        break;
      }

      // Max iterations reached
      if (iteration >= MAX_TOOL_ITERATIONS) {
        Logger.warn("ToolUseRegistry", `========== PROCESS END (max iterations: ${iteration}) ==========`);
        return {
          success: false,
          error: `操作已执行，但达到处理上限 (${iteration} 次迭代)。工具调用可能已完成，请检查结果。`,
        };
      }

      Logger.warn("ToolUseRegistry", "========== PROCESS END (no response) ==========");
      return {
        success: false,
        error: "无法生成回复",
      };
    } catch (error: any) {
      Logger.error("ToolUseRegistry", "========== PROCESS END (error) ==========", {
        error: error.message,
        stack: error.stack,
      });
      return {
        success: false,
        error: `处理失败: ${error.message}`,
      };
    }
  }
}
