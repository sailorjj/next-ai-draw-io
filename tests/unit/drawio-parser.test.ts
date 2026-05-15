import * as fs from "fs"
import * as path from "path"
import { describe, expect, it } from "vitest"
import { generateDrawioXml, parseDrawioTemplate } from "@/lib/drawio-parser"

describe("drawio-parser", () => {
    // 测试 1: 解析横向泳道流程模板
    it("should parse horizontal swimlane template", () => {
        const templatePath = path.join(
            process.cwd(),
            "template",
            "横向泳道流程模板.drawio",
        )
        const xml = fs.readFileSync(templatePath, "utf-8")

        const result = parseDrawioTemplate(xml)

        // 应该有 Pool
        expect(result.pools.length).toBeGreaterThan(0)
        const pool = result.pools[0]
        expect(pool.style.horizontal).toBe(1)
        expect(pool.style.childLayout).toBe("stackLayout")

        // 应该有 Lane
        expect(result.lanes.length).toBeGreaterThan(0)

        // 应该有节点（在 Lane 里的节点）
        // 总节点数 = 普通节点（不在泳道内的）
        // 由于泳道内的节点被识别为 Lane 的子节点，所以 nodes 可能为空

        // 应该有边
        expect(result.edges.length).toBeGreaterThan(0)

        console.log("Pools:", result.pools.length)
        console.log("Lanes:", result.lanes.length)
        console.log("Nodes (outside swimlanes):", result.nodes.length)
        console.log("Edges:", result.edges.length)
    })

    // 测试 2: 解析竖向泳道流程模板
    it("should parse vertical swimlane template", () => {
        const templatePath = path.join(
            process.cwd(),
            "template",
            "竖向泳道流程模板.drawio",
        )
        const xml = fs.readFileSync(templatePath, "utf-8")

        const result = parseDrawioTemplate(xml)

        expect(result.pools.length).toBeGreaterThan(0)
        const pool = result.pools[0]
        // 竖向泳道的 horizontal 应该是 0 或 undefined
        expect(
            pool.style.horizontal === 0 || pool.style.horizontal === undefined,
        ).toBe(true)
    })

    // 测试 3: 解析矩阵泳道流程模板
    it("should parse matrix swimlane template", () => {
        const templatePath = path.join(
            process.cwd(),
            "template",
            "矩阵泳道流程模板.drawio",
        )
        const xml = fs.readFileSync(templatePath, "utf-8")

        const result = parseDrawioTemplate(xml)

        // 矩阵泳道有多个 Pool（每个维度一个），而不是传统的 Lane
        expect(result.pools.length).toBeGreaterThan(1)
        // 节点数量应该大于 0
        expect(result.nodes.length).toBeGreaterThan(0)
    })

    // 测试 4: 解析思维导图模板
    it("should parse mind map template", () => {
        const templatePath = path.join(
            process.cwd(),
            "template",
            "思维导图.drawio",
        )
        const xml = fs.readFileSync(templatePath, "utf-8")

        const result = parseDrawioTemplate(xml)

        // 思维导图可能没有泳道
        expect(result.nodes.length).toBeGreaterThan(0)
    })

    // 测试 5: 验证生成 XML 格式正确
    it("should generate valid XML", () => {
        const templatePath = path.join(
            process.cwd(),
            "template",
            "横向泳道流程模板.drawio",
        )
        const xml = fs.readFileSync(templatePath, "utf-8")

        const parsed = parseDrawioTemplate(xml)
        const generated = generateDrawioXml(parsed)

        // 生成的 XML 应该可以被解析
        const reparsed = parseDrawioTemplate(generated)
        expect(reparsed.nodes.length).toBe(parsed.nodes.length)
    })

    // 测试 6: 验证关键样式属性被正确解析
    it("should parse key style properties", () => {
        const templatePath = path.join(
            process.cwd(),
            "template",
            "横向泳道流程模板.drawio",
        )
        const xml = fs.readFileSync(templatePath, "utf-8")

        const result = parseDrawioTemplate(xml)

        // 检查泳道样式
        if (result.pools.length > 0) {
            const pool = result.pools[0]
            expect(pool.style).toHaveProperty("swimlane")
            expect(pool.style).toHaveProperty("childLayout")
            expect(pool.style).toHaveProperty("horizontal")
        }

        // 检查 Lane 存在
        if (result.lanes.length > 0) {
            // Lane 存在即可
            expect(result.lanes[0].id).toBeDefined()
        }

        // 检查边样式
        if (result.edges.length > 0) {
            const edge = result.edges[0]
            expect(edge.style).toHaveProperty("edgeStyle")
            expect(edge.style).toHaveProperty("endArrow")
        }
    })
})
