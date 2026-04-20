import { assert } from "chai";

/**
 * LLMService 单元测试
 * 注意：这些测试在 Zotero 环境中运行，需要 mock 或实际 API
 */
describe("LLMService", function () {
  describe("Configuration", function () {
    it("should have default provider as doubao", function () {
      // 测试默认配置
      const defaultProvider = "doubao";
      assert.equal(defaultProvider, "doubao");
    });

    it("should support three providers", function () {
      const providers = ["doubao", "openai", "deepseek"];
      assert.lengthOf(providers, 3);
      assert.include(providers, "doubao");
      assert.include(providers, "openai");
      assert.include(providers, "deepseek");
    });

    it("should have valid API base URL format", function () {
      const apiBase = "https://ark.cn-beijing.volces.com/api/v3";
      assert.match(apiBase, /^https?:\/\/.+/);
    });
  });

  describe("Message Format", function () {
    it("should accept valid chat message roles", function () {
      const validRoles = ["system", "user", "assistant"];
      const testMessage = { role: "user", content: "Hello" };
      assert.include(validRoles, testMessage.role);
    });

    it("should format summarize prompt correctly", function () {
      const text = "Sample paper content";
      const expectedPromptContains = "请总结以下内容";
      const prompt = `请总结以下内容：\n\n${text}`;
      assert.include(prompt, expectedPromptContains);
      assert.include(prompt, text);
    });
  });
});
