/**
 * Slash command system
 *
 * Usage: Enter /command-name [args] in chat input box
 * Example: /model doubao-pro-32k
 */

import { Logger } from "../utils/logger";
import { getPref, setPref } from "../utils/prefs";

/**
 * Command execution result
 */
export interface CommandResult {
  success: boolean;
  message: string;
  /** Whether to refresh LLM Service */
  refreshLLM?: boolean;
}

/**
 * Command definition
 */
export interface Command {
  name: string;
  description: string;
  usage: string;
  execute: (args: string) => CommandResult | Promise<CommandResult>;
}

/**
 * Command registry
 */
class CommandRegistry {
  private commands: Map<string, Command> = new Map();

  register(command: Command) {
    this.commands.set(command.name, command);
  }

  get(name: string): Command | undefined {
    return this.commands.get(name);
  }

  getAll(): Command[] {
    return Array.from(this.commands.values());
  }

  /**
   * Check if input is a command
   */
  isCommand(input: string): boolean {
    return input.trim().startsWith("/");
  }

  /**
   * Parse and execute command
   */
  async execute(input: string): Promise<CommandResult | null> {
    if (!this.isCommand(input)) {
      return null;
    }

    const trimmed = input.trim();
    const spaceIndex = trimmed.indexOf(" ");
    const commandName =
      spaceIndex > 0 ? trimmed.substring(1, spaceIndex) : trimmed.substring(1);
    const args = spaceIndex > 0 ? trimmed.substring(spaceIndex + 1).trim() : "";

    const command = this.get(commandName);
    if (!command) {
      return {
        success: false,
        message: `未知命令: /${commandName}\n输入 /help 查看可用命令`,
      };
    }

    Logger.info("Command", `Executing /${commandName}`, { args });

    try {
      return await command.execute(args);
    } catch (error: any) {
      Logger.error("Command", `Error executing /${commandName}`, error.message);
      return {
        success: false,
        message: `命令执行失败: ${error.message}`,
      };
    }
  }
}

// Create global command registry
export const commandRegistry = new CommandRegistry();

// ==================== Register built-in commands ====================

/**
 * /help - Show help information
 */
commandRegistry.register({
  name: "help",
  description: "显示帮助信息",
  usage: "/help",
  execute: () => {
    const commands = commandRegistry.getAll();
    let message = "**可用命令：**\n\n";
    for (const cmd of commands) {
      message += `\`${cmd.usage}\`\n  ${cmd.description}\n\n`;
    }
    return { success: true, message };
  },
});

/**
 * /model - View or set model
 */
commandRegistry.register({
  name: "model",
  description: "查看或设置 LLM 模型",
  usage: "/model [模型名称]",
  execute: (args) => {
    if (!args) {
      const currentModel = getPref("llm.model") as string;
      return {
        success: true,
        message: `**当前模型：** ${currentModel || "未配置"}`,
      };
    }

    setPref("llm.model" as any, args);
    Logger.info("Command", "Model changed", { model: args });

    return {
      success: true,
      message: `✅ 模型已设置为: ${args}`,
      refreshLLM: true,
    };
  },
});

/**
 * /apibase - View or set API base URL
 */
commandRegistry.register({
  name: "apibase",
  description: "查看或设置 API Base URL",
  usage: "/apibase [URL]",
  execute: (args) => {
    if (!args) {
      const currentBase = getPref("llm.apiBase") as string;
      return {
        success: true,
        message: currentBase
          ? `**当前 API Base：** ${currentBase}`
          : "**API Base 未配置**\n使用 `/apibase <URL>` 设置",
      };
    }

    // Simple URL validation
    if (!args.startsWith("http://") && !args.startsWith("https://")) {
      return {
        success: false,
        message: "API Base 必须以 http:// 或 https:// 开头",
      };
    }

    setPref("llm.apiBase" as any, args);
    Logger.info("Command", "API Base changed", { apiBase: args });

    return {
      success: true,
      message: `✅ API Base 已设置为: ${args}`,
      refreshLLM: true,
    };
  },
});

/**
 * /apikey - Set API Key
 */
commandRegistry.register({
  name: "apikey",
  description: "设置 API Key",
  usage: "/apikey <key>",
  execute: (args) => {
    if (!args) {
      const hasKey = !!(getPref("llm.apiKey") as string);
      return {
        success: true,
        message: hasKey ? "API Key 已配置 ✅" : "API Key 未配置 ❌",
      };
    }

    setPref("llm.apiKey" as any, args);
    Logger.info("Command", "API Key changed");

    return {
      success: true,
      message: "✅ API Key 已设置",
      refreshLLM: true,
    };
  },
});

/**
 * /config - Show all configurations
 */
commandRegistry.register({
  name: "config",
  description: "显示所有 LLM 配置",
  usage: "/config",
  execute: () => {
    const model = getPref("llm.model") as string;
    const apiBase = getPref("llm.apiBase") as string;
    const apiKey = getPref("llm.apiKey") as string;

    const message = `**LLM 配置：**

| 配置项 | 值 |
|--------|-----|
| API Base | ${apiBase || "未配置 ❌"} |
| API Key | ${apiKey ? "已配置 ✅" : "未配置 ❌"} |
| Model | ${model || "未配置 ❌"} |

**快速配置命令：**
- \`/apibase <URL>\` - 设置 API 地址
- \`/apikey <key>\` - 设置 API Key
- \`/model <名称>\` - 设置模型
- \`/reset\` - 重置所有配置`;

    return { success: true, message };
  },
});

/**
 * /clear - Clear chat history
 */
commandRegistry.register({
  name: "clear",
  description: "清空当前对话历史",
  usage: "/clear",
  execute: () => {
    // Return special marker for SidePanel to handle clearing
    return {
      success: true,
      message: "__CLEAR_CHAT__",
    };
  },
});

/**
 * /reset - Reset all LLM configurations
 */
commandRegistry.register({
  name: "reset",
  description: "重置所有 LLM 配置",
  usage: "/reset",
  execute: () => {
    // Clear all LLM configurations
    setPref("llm.apiKey" as any, "");
    setPref("llm.apiBase" as any, "");
    setPref("llm.model" as any, "");

    Logger.info("Command", "LLM config reset");

    return {
      success: true,
      message: `✅ LLM 配置已重置

所有配置已清空：
- API Base
- API Key
- Model

请使用以下命令重新配置：
\`/apibase <URL>\` - 设置 API 地址
\`/apikey <key>\` - 设置 API Key
\`/model <名称>\` - 设置模型`,
      refreshLLM: true,
    };
  },
});
