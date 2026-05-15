import * as fs from "fs"
import * as path from "path"
import { describe, expect, it } from "vitest"
import { parseDrawioTemplate } from "@/lib/drawio-parser"
import { needsOptimization, optimizeLayout } from "@/lib/layout-optimizer"

describe("layout-optimizer", () => {
    // 测试 1: 检测是否需要优化
    it("should detect if optimization is needed", () => {
        const templatePath = path.join(
            process.cwd(),
            "template",
            "横向泳道流程模板.drawio",
        )
        const xml = fs.readFileSync(templatePath, "utf-8")

        // 模板应该不需要优化（是有效布局）
        const needs = needsOptimization(xml)
        console.log("Needs optimization:", needs)
    })

    // 测试 2: 执行优化
    it("should optimize layout", () => {
        const templatePath = path.join(
            process.cwd(),
            "template",
            "横向泳道流程模板.drawio",
        )
        const xml = fs.readFileSync(templatePath, "utf-8")

        const optimized = optimizeLayout(xml)

        // 验证优化后的 XML 仍然有效
        expect(optimized).toContain("mxfile")
        expect(optimized).toContain("mxGraphModel")

        console.log("Original length:", xml.length)
        console.log("Optimized length:", optimized.length)
    })

    // 测试 3: 优化后可以被重新解析
    it("should generate re-parseable XML", () => {
        const templatePath = path.join(
            process.cwd(),
            "template",
            "横向泳道流程模板.drawio",
        )
        const xml = fs.readFileSync(templatePath, "utf-8")

        const optimized = optimizeLayout(xml)
        const reparsed = parseDrawioTemplate(optimized)

        expect(reparsed.pools.length).toBeGreaterThan(0)
        expect(reparsed.lanes.length).toBeGreaterThan(0)
    })
})
