import * as fs from "fs"
import * as path from "path"
import { describe, expect, it } from "vitest"
import { parseStyleTemplate, styleToDrawioStyle } from "@/lib/style-parser"

describe("style-parser", () => {
    it("should parse DESIGN-claude.md", () => {
        const templatePath = path.join(
            process.cwd(),
            "template",
            "DESIGN-claude.md",
        )
        const content = fs.readFileSync(templatePath, "utf-8")

        const result = parseStyleTemplate(content)

        expect(result.name).toBe("Claude")
        expect(result.version).toBe("alpha")
        expect(result.colors).toBeDefined()
        expect(result.colors.primary).toBe("#cc785c")
        expect(result.colors.canvas).toBe("#faf9f5")

        console.log("Parsed style template:", {
            name: result.name,
            version: result.version,
            primaryColor: result.colors.primary,
            canvasColor: result.colors.canvas,
        })
    })

    it("should convert to drawio style", () => {
        const templatePath = path.join(
            process.cwd(),
            "template",
            "DESIGN-claude.md",
        )
        const content = fs.readFileSync(templatePath, "utf-8")

        const parsed = parseStyleTemplate(content)
        const drawioStyle = styleToDrawioStyle(parsed)

        console.log("Draw.io style:", drawioStyle)

        expect(drawioStyle.fillColor).toBeDefined()
        expect(drawioStyle.strokeColor).toBeDefined()
    })
})
