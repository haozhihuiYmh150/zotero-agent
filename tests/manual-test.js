/**
 * Zotero Agent 测试脚本
 *
 * 使用方法：
 * 1. 在 Zotero 中打开 Tools > Developer > Run JavaScript
 * 2. 复制粘贴本文件内容
 * 3. 点击 Run
 */

(async function runTests() {
  const results = [];

  function log(test, passed, detail = "") {
    const status = passed ? "✅" : "❌";
    results.push({ test, passed, detail });
    Zotero.debug(`[Test] ${status} ${test}: ${detail}`);
  }

  // ========== 测试 1: 插件是否加载 ==========
  try {
    const addon = Zotero.ZoteroAgent;
    log("插件加载", !!addon, addon ? "已加载" : "未找到");
  } catch (e) {
    log("插件加载", false, e.message);
  }

  // ========== 测试 2: 获取当前选中条目 ==========
  try {
    const items = ZoteroPane.getSelectedItems();
    log("获取选中条目", items.length > 0, `${items.length} 个条目`);
    if (items.length > 0) {
      log("条目标题", true, items[0].getField("title"));
    }
  } catch (e) {
    log("获取选中条目", false, e.message);
  }

  // ========== 测试 3: arXiv 搜索 ==========
  try {
    const query = "transformer attention";
    const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&max_results=2`;
    const response = await Zotero.HTTP.request("GET", url, {
      responseType: "text",
    });
    const hasResults = response.response.includes("<entry>");
    log("arXiv API", response.status === 200, `status=${response.status}`);
    log("arXiv 搜索结果", hasResults, hasResults ? "找到论文" : "无结果");
  } catch (e) {
    log("arXiv API", false, e.message);
  }

  // ========== 测试 4: PDF 阅读器选中文本 ==========
  try {
    const readers = Zotero.Reader._readers;
    log(
      "PDF 阅读器",
      readers && readers.length > 0,
      `${readers?.length || 0} 个阅读器打开`,
    );

    if (readers && readers.length > 0) {
      const reader = readers[readers.length - 1];
      const win = reader?._internalReader?._primaryView?._iframeWindow;
      if (win) {
        const selection = win.getSelection?.();
        const text = selection?.toString()?.trim();
        log(
          "选中文本",
          text?.length > 0,
          text ? `${text.length} 字符` : "无选中",
        );
      }
    }
  } catch (e) {
    log("PDF 阅读器", false, e.message);
  }

  // ========== 测试 5: LLM 配置 ==========
  try {
    const apiKey = Zotero.Prefs.get("extensions.zotero.zoteroagent.llm.apiKey");
    const model = Zotero.Prefs.get("extensions.zotero.zoteroagent.llm.model");
    log("API Key 配置", !!apiKey, apiKey ? "已设置" : "未设置");
    log("模型配置", !!model, model || "默认");
  } catch (e) {
    log("LLM 配置", false, e.message);
  }

  // ========== 汇总 ==========
  const passed = results.filter((r) => r.passed).length;
  const total = results.length;

  Zotero.debug(`\n========== 测试结果 ==========`);
  Zotero.debug(`通过: ${passed}/${total}`);
  results.forEach((r) => {
    Zotero.debug(`${r.passed ? "✅" : "❌"} ${r.test}: ${r.detail}`);
  });

  // 返回结果供查看
  return { passed, total, results };
})();
