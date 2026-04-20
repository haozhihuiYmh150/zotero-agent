import { config } from "../../package.json";
import { getString } from "../utils/locale";
import { LLMService } from "../services/LLMService";
import { AgentCore } from "../modules/agent";

export async function registerPrefsScripts(_window: Window) {
  // Preferences window registered
}

/**
 * 测试 LLM 连接
 */
export async function testConnection(_window: Window) {
  const resultSpan = _window.document.getElementById(
    `zotero-prefpane-${config.addonRef}-test-result`,
  ) as HTMLSpanElement | null;

  if (resultSpan) {
    resultSpan.textContent = "Testing...";
    resultSpan.style.color = "#666";
  }

  try {
    // 重置 LLM Service 以使用最新配置
    AgentCore.resetLLMService();
    const llmService = AgentCore.getLLMService();
    const success = await llmService.testConnection();

    if (resultSpan) {
      if (success) {
        resultSpan.textContent = getString("pref-test-success");
        resultSpan.style.color = "green";
      } else {
        resultSpan.textContent = getString("pref-test-fail");
        resultSpan.style.color = "red";
      }
    }
  } catch (error: any) {
    if (resultSpan) {
      resultSpan.textContent = `${getString("pref-test-fail")}: ${error.message}`;
      resultSpan.style.color = "red";
    }
  }
}
