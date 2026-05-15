import * as fs from "fs"
import * as path from "path"
import { describe, expect, it } from "vitest"
import { needsOptimization, optimizeLayout } from "@/lib/layout-optimizer"

describe("layout-optimizer boundary tests", () => {
    // 测试 1: 空输入 - needsOptimization 返回 false
    it("should handle empty input", () => {
        expect(() => optimizeLayout("")).toThrow()
        // needsOptimization 对空输入返回 false
        expect(needsOptimization("")).toBe(false)
    })

    // 测试 2: 无效 XML - needsOptimization 返回 false，不抛出异常
    it("should handle invalid XML", () => {
        expect(() => optimizeLayout("<invalid>")).toThrow()
        // needsOptimization 对无效 XML 返回 false，不抛出
        expect(needsOptimization("<invalid>")).toBe(false)
    })

    // 测试 3: 正常文件
    it("should work with valid template", () => {
        const templatePath = path.join(
            process.cwd(),
            "template",
            "横向泳道流程模板.drawio",
        )
        const xml = fs.readFileSync(templatePath, "utf-8")

        const result = optimizeLayout(xml)
        expect(result).toContain("mxfile")

        const needs = needsOptimization(xml)
        expect(typeof needs).toBe("boolean")
    })

    // 测试 4: 多次优化稳定性
    it("should be stable with multiple optimizations", () => {
        const templatePath = path.join(
            process.cwd(),
            "template",
            "横向泳道流程模板.drawio",
        )
        const xml = fs.readFileSync(templatePath, "utf-8")

        // 多次优化应该产生相同结果
        const result1 = optimizeLayout(xml)
        const result2 = optimizeLayout(result1)
        const result3 = optimizeLayout(result2)

        expect(result1).toBe(result2)
        expect(result2).toBe(result3)
    })

    // 测试 5: 自定义选项
    it("should accept custom options", () => {
        const templatePath = path.join(
            process.cwd(),
            "template",
            "横向泳道流程模板.drawio",
        )
        const xml = fs.readFileSync(templatePath, "utf-8")

        const result = optimizeLayout(xml, {
            padding: 50,
            minLaneWidth: 300,
            minLaneHeight: 200,
        })

        expect(result).toContain("mxfile")
    })
})
