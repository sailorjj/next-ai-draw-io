import { describe, expect, it } from "vitest"
import { generateDrawioXml, parseDrawioTemplate } from "@/lib/drawio-parser"

describe("drawio-parser boundary tests", () => {
    // 测试 1: 空输入
    it("should throw on empty input", () => {
        expect(() => parseDrawioTemplate("")).toThrow()
        expect(() => parseDrawioTemplate(null as any)).toThrow()
        expect(() => parseDrawioTemplate(undefined as any)).toThrow()
    })

    // 测试 2: 无效 XML
    it("should throw on invalid XML", () => {
        expect(() =>
            parseDrawioTemplate("<not-drawio>test</not-drawio>"),
        ).toThrow()
    })

    // 测试 3: 缺少必需元素
    it("should throw on missing mxGraphModel", () => {
        expect(() => parseDrawioTemplate("<mxfile></mxfile>")).toThrow()
    })

    // 测试 4: 正常文件仍然工作
    it("should still work with valid input", () => {
        const validXml = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="jgraph.github.io">
  <diagram name="Page-1" id="diagram-1">
    <mxGraphModel dx="1046" dy="740" grid="1" gridSize="10">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
        <mxCell id="node1" parent="1" value="Test" vertex="1">
          <mxGeometry x="100" y="100" width="70" height="37" as="geometry" />
        </mxCell>
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`

        const result = parseDrawioTemplate(validXml)
        expect(result.nodes.length).toBe(1)
        expect(result.nodes[0].value).toBe("Test")
    })

    // 测试 5: 生成 XML 格式正确
    it("should generate valid XML", () => {
        const validXml = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="jgraph.github.io">
  <diagram name="Page-1" id="diagram-1">
    <mxGraphModel>
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`

        const parsed = parseDrawioTemplate(validXml)
        const generated = generateDrawioXml(parsed)

        expect(generated).toContain("<?xml")
        expect(generated).toContain("<mxfile")
        expect(generated).toContain("<mxGraphModel")
        expect(generated).toContain("</mxGraphModel>")
    })
})
