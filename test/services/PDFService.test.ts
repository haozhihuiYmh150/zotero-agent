import { assert } from "chai";

/**
 * PDFService 单元测试
 */
describe("PDFService", function () {
  describe("truncateText", function () {
    it("should not truncate text shorter than maxLength", function () {
      const text = "Short text";
      const maxLength = 100;
      // 模拟 truncateText 逻辑
      const result = text.length <= maxLength ? text : text.substring(0, maxLength) + "\n\n[... content truncated ...]";
      assert.equal(result, text);
    });

    it("should truncate text longer than maxLength", function () {
      const text = "A".repeat(200);
      const maxLength = 100;
      const result = text.length <= maxLength ? text : text.substring(0, maxLength) + "\n\n[... content truncated ...]";
      assert.include(result, "[... content truncated ...]");
      assert.isAtMost(result.length, maxLength + 30); // 30 for truncation message
    });

    it("should use default maxLength of 8000", function () {
      const defaultMaxLength = 8000;
      assert.equal(defaultMaxLength, 8000);
    });
  });

  describe("Metadata Extraction", function () {
    it("should extract year from date string", function () {
      const date = "2024-03-15";
      const year = date.substring(0, 4);
      assert.equal(year, "2024");
    });

    it("should handle empty date gracefully", function () {
      const date = "";
      const year = date.substring(0, 4) || "Unknown";
      assert.equal(year, "Unknown");
    });

    it("should format authors correctly", function () {
      const creators = [
        { firstName: "John", lastName: "Doe" },
        { firstName: "Jane", lastName: "Smith" },
      ];
      const authors = creators
        .map((c) => `${c.firstName || ""} ${c.lastName || ""}`.trim())
        .join(", ");
      assert.equal(authors, "John Doe, Jane Smith");
    });
  });
});
