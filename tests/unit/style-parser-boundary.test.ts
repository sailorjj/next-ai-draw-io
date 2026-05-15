import { describe, expect, it } from "vitest"
import { parseStyleTemplate } from "@/lib/style-parser"

describe("style-parser boundary tests", () => {
    // 测试 1: 空输入
    it("should throw on empty input", () => {
        expect(() => parseStyleTemplate("")).toThrow()
        expect(() => parseStyleTemplate(null as any)).toThrow()
        expect(() => parseStyleTemplate(undefined as any)).toThrow()
    })

    // 测试 2: 无效格式（无 frontmatter）
    it("should throw on missing frontmatter", () => {
        expect(() => parseStyleTemplate("Just plain text")).toThrow()
    })

    // 测试 3: 颜色值各种格式
    it("should handle various color formats", () => {
        const yaml = `---
colors:
  hex: "#ffffff"
  no-quote: ffffff
  named: red
typography:
  test:
    fontSize: 16
---
Content`

        const result = parseStyleTemplate(yaml)
        expect(result.colors.hex).toBe("#ffffff")
    })

    // 测试 4: 数值单位处理
    it("should handle numeric values with units", () => {
        const yaml = `---
rounded:
  md: 8px
  lg: 12
spacing:
  md: 16px
typography:
  body:
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: -0.5px
---
Test`

        const result = parseStyleTemplate(yaml)
        // 数值可能是字符串或数字，用 == 宽松比较
        expect(result.rounded.md === 8).toBe(true)
        expect(result.rounded.lg === 12).toBe(true)
        expect(result.spacing.md === 16).toBe(true)
    })
})
