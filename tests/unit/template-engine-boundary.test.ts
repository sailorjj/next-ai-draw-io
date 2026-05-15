import * as fs from "fs"
import * as path from "path"
import { describe, expect, it } from "vitest"
import { parseDrawioTemplate } from "@/lib/drawio-parser"
import { type BusinessData, generateFromTemplate } from "@/lib/template-engine"

describe("template-engine boundary tests", () => {
    // 测试 1: 空业务数据
    it("should handle empty business data", () => {
        const templatePath = path.join(
            process.cwd(),
            "template",
            "横向泳道流程模板.drawio",
        )
        const xml = fs.readFileSync(templatePath, "utf-8")
        const template = parseDrawioTemplate(xml)

        const emptyData: BusinessData = {
            lanes: [],
            nodes: [],
            edges: [],
        }

        // 空数据应该也能生成（只是没有节点）
        const result = generateFromTemplate({
            template,
            businessData: emptyData,
        })
        expect(result).toContain("mxfile")
    })

    // 测试 2: 单节点
    it("should handle single node", () => {
        const templatePath = path.join(
            process.cwd(),
            "template",
            "横向泳道流程模板.drawio",
        )
        const xml = fs.readFileSync(templatePath, "utf-8")
        const template = parseDrawioTemplate(xml)

        const singleNodeData: BusinessData = {
            lanes: ["部门A"],
            nodes: [{ id: "1", label: "开始", laneId: "部门A" }],
            edges: [],
        }

        const result = generateFromTemplate({
            template,
            businessData: singleNodeData,
        })
        expect(result).toContain("部门A")
        expect(result).toContain("开始")
    })

    // 测试 3: 多个泳道
    it("should handle multiple lanes", () => {
        const templatePath = path.join(
            process.cwd(),
            "template",
            "横向泳道流程模板.drawio",
        )
        const xml = fs.readFileSync(templatePath, "utf-8")
        const template = parseDrawioTemplate(xml)

        const multiLaneData: BusinessData = {
            lanes: ["部门A", "部门B", "部门C"],
            nodes: [
                { id: "1", label: "A1", laneId: "部门A" },
                { id: "2", label: "B1", laneId: "部门B" },
                { id: "3", label: "C1", laneId: "部门C" },
            ],
            edges: [],
        }

        const result = generateFromTemplate({
            template,
            businessData: multiLaneData,
        })
        expect(result).toContain("部门A")
        expect(result).toContain("部门B")
        expect(result).toContain("部门C")
    })

    // 测试 4: 大量节点
    it("should handle many nodes", () => {
        const templatePath = path.join(
            process.cwd(),
            "template",
            "横向泳道流程模板.drawio",
        )
        const xml = fs.readFileSync(templatePath, "utf-8")
        const template = parseDrawioTemplate(xml)

        // 创建 20 个节点
        const manyNodes: BusinessData = {
            lanes: ["测试"],
            nodes: Array.from({ length: 20 }, (_, i) => ({
                id: `${i}`,
                label: `节点${i + 1}`,
                laneId: "测试",
            })),
            edges: [],
        }

        const result = generateFromTemplate({
            template,
            businessData: manyNodes,
        })
        expect(result).toContain("节点1")
        expect(result).toContain("节点20")
    })
})
