/**
 * Tool base interface and abstract class
 *
 * Progressive architecture:
 * 1. Each tool implements the unified Tool interface
 * 2. Tools are registered to ToolRegistry
 * 3. After intent analysis, ToolRegistry dispatches execution
 *
 * Future upgrades:
 * - Expose tool definitions to LLM (Function Calling)
 * - LLM autonomously decides which tool to call
 */

import { Logger } from "../utils/logger";

/**
 * Tool execution context
 */
export interface ToolContext {
  /** Currently selected Zotero item */
  currentItem: Zotero.Item | null;
  /** Metadata of current item */
  metadata: {
    title?: string;
    authors?: string;
    year?: string;
    abstract?: string;
  } | null;
  /** Selected text in PDF */
  selectedText?: string;
  /** Chat history */
  chatHistory?: Array<{ role: string; content: string }>;
}

/**
 * Tool execution parameters
 */
export interface ToolParams {
  /** Original user input */
  userInput: string;
  /** Parameters extracted from intent analysis */
  [key: string]: any;
}

/**
 * Tool execution result
 */
export interface ToolResult {
  /** Whether successful */
  success: boolean;
  /** Result message (shown to user) */
  message?: string;
  /** Structured data (optional, for further processing) */
  data?: any;
  /** Error message */
  error?: string;
  /** Whether streaming response is needed */
  streaming?: boolean;
}

/**
 * Streaming callback
 */
export type StreamCallback = (chunk: string, fullText: string) => void;

/**
 * Status update callback
 */
export type StatusCallback = (status: string) => void;

/**
 * Tool interface
 */
export interface Tool {
  /** Tool unique identifier */
  name: string;

  /** Tool description (used for intent matching and future Function Calling) */
  description: string;

  /** Tool parameter specifications (used for intent analysis prompts) */
  parameters: {
    name: string;
    description: string;
    required: boolean;
  }[];

  /**
   * Execute tool
   * @param params Execution parameters
   * @param context Execution context
   * @param callbacks Callback functions
   */
  execute(
    params: ToolParams,
    context: ToolContext,
    callbacks: {
      onStatus?: StatusCallback;
      onStream?: StreamCallback;
    },
  ): Promise<ToolResult>;
}

/**
 * Tool base class - provides common functionality
 */
export abstract class BaseTool implements Tool {
  abstract name: string;
  abstract description: string;
  abstract parameters: Tool["parameters"];

  protected log(
    level: "info" | "debug" | "warn" | "error",
    message: string,
    ...args: any[]
  ) {
    Logger[level](`Tool:${this.name}`, message, ...args);
  }

  abstract execute(
    params: ToolParams,
    context: ToolContext,
    callbacks: {
      onStatus?: StatusCallback;
      onStream?: StreamCallback;
    },
  ): Promise<ToolResult>;

  /**
   * Generate tool's JSON Schema (for Function Calling)
   */
  toJSONSchema(): object {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: "object",
        properties: Object.fromEntries(
          this.parameters.map((p) => [
            p.name,
            { type: "string", description: p.description },
          ]),
        ),
        required: this.parameters.filter((p) => p.required).map((p) => p.name),
      },
    };
  }
}
