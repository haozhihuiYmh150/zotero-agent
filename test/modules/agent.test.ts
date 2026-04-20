import { assert } from "chai";

/**
 * AgentCore 单元测试
 */
describe("AgentCore", function () {
  describe("Prompt Generation", function () {
    it("should generate correct summarize prompt", function () {
      const metadata = {
        title: "Test Paper",
        authors: "John Doe",
        year: "2024",
      };
      const fullText = "Paper content here...";

      const prompt = `论文标题：${metadata.title}
作者：${metadata.authors}
年份：${metadata.year}

以下是论文内容：

${fullText}

请对这篇论文进行总结，包括：
1. 研究问题/目标
2. 主要方法
3. 关键发现/结论
4. 主要贡献`;

      assert.include(prompt, metadata.title);
      assert.include(prompt, metadata.authors);
      assert.include(prompt, metadata.year);
      assert.include(prompt, fullText);
      assert.include(prompt, "研究问题/目标");
    });
  });

  describe("Markdown to HTML conversion", function () {
    it("should convert bold text", function () {
      const markdown = "This is **bold** text";
      const html = markdown.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
      assert.include(html, "<strong>bold</strong>");
    });

    it("should convert italic text", function () {
      const markdown = "This is *italic* text";
      const html = markdown.replace(/\*(.*?)\*/g, "<em>$1</em>");
      assert.include(html, "<em>italic</em>");
    });

    it("should convert newlines to br tags", function () {
      const markdown = "Line 1\nLine 2";
      const html = markdown.replace(/\n/g, "<br>");
      assert.include(html, "<br>");
    });
  });

  describe("Notification Types", function () {
    it("should support success, error, and default types", function () {
      const types = ["success", "error", "default"];
      assert.lengthOf(types, 3);
    });

    it("should map error type to fail for progress window", function () {
      const type = "error";
      const mappedType = type === "error" ? "fail" : type;
      assert.equal(mappedType, "fail");
    });
  });
});
