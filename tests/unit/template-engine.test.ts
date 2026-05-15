import * as fs from "fs"
import * as path from "path"
import { describe, expect, it } from "vitest"
import { parseDrawioTemplate } from "@/lib/drawio-parser"
import { parseStyleTemplate } from "@/lib/style-parser"
import {
    type BusinessData,
    extractLayoutStructure,
    generateFromTemplate,
} from "@/lib/template-engine"

describe("template-engine", () => {
    // 测试 1: 提取布局结构
    it("should extract layout structure from template", () => {
        const templatePath = path.join(
            process.cwd(),
            "template",
            "横向泳道流程模板.drawio",
        )
        const xml = fs.readFileSync(templatePath, "utf-8")

        const template = parseDrawioTemplate(xml)
        const layout = extractLayoutStructure(template)

        expect(layout).not.toBeNull()
        expect(layout?.isHorizontal).toBe(true)
        expect(layout?.lanes.length).toBeGreaterThan(0)
    })

    // 测试 2: 生成新图表
    it("should generate new diagram from template", () => {
        const templatePath = path.join(
            process.cwd(),
            "template",
            "横向泳道流程模板.drawio",
        )
        const xml = fs.readFileSync(templatePath, "utf-8")

        const template = parseDrawioTemplate(xml)

        // 简单的业务数据
        const businessData: BusinessData = {
            lanes: ["用户", "系统"],
            nodes: [
                { id: "1", label: "登录", laneId: "用户" },
                { id: "2", label: "验证", laneId: "系统" },
                { id: "3", label: "成功", laneId: "用户" },
            ],
            edges: [
                { from: "1", to: "2" },
                { from: "2", to: "3" },
            ],
        }

        const result = generateFromTemplate({
            template,
            businessData,
        })

        // 验证生成的 XML 包含关键元素
        expect(result).toContain("mxfile")
        expect(result).toContain("mxGraphModel")

        // 验证包含泳道
        expect(result).toContain("用户")
        expect(result).toContain("系统")

        console.log("Generated XML length:", result.length)
    })

    // 测试 3: 带样式模板生成
    it("should apply style template", () => {
        const templatePath = path.join(
            process.cwd(),
            "template",
            "横向泳道流程模板.drawio",
        )
        const stylePath = path.join(
            process.cwd(),
            "template",
            "DESIGN-claude.md",
        )

        const xml = fs.readFileSync(templatePath, "utf-8")
        const styleContent = fs.readFileSync(stylePath, "utf-8")

        const template = parseDrawioTemplate(xml)
        const style = parseStyleTemplate(styleContent)

        const businessData: BusinessData = {
            lanes: ["部门A", "部门B"],
            nodes: [
                { id: "1", label: "申请", laneId: "部门A" },
                { id: "2", label: "审批", laneId: "部门B" },
            ],
            edges: [{ from: "1", to: "2" }],
        }

        const result = generateFromTemplate({
            template,
            style,
            businessData,
        })

        expect(result).toContain("部门A")
        expect(result).toContain("部门B")

        console.log("Generated with style, length:", result.length)
    })
})
