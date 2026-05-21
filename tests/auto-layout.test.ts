import { describe, expect, it } from "vitest"
import { applyAutoLayout } from "@/lib/utils"

// ============================================================================
// Helper Functions
// ============================================================================

/** Parse a cell from the output XML to extract its geometry and attributes */
function parseCell(xml: string, id: string) {
    const parser = new DOMParser()
    const doc = parser.parseFromString(xml, "text/xml")
    const cellEl = doc.querySelector(`mxCell[id="${id}"]`)
    if (!cellEl) return null

    const geoEl = cellEl.querySelector("mxGeometry")
    const x = parseFloat(geoEl?.getAttribute("x") || "0") || 0
    const y = parseFloat(geoEl?.getAttribute("y") || "0") || 0
    const w = parseFloat(geoEl?.getAttribute("width") || "0") || 0
    const h = parseFloat(geoEl?.getAttribute("height") || "0") || 0

    return {
        x,
        y,
        w,
        h,
        parent: cellEl.getAttribute("parent") || "",
        vertex: cellEl.getAttribute("vertex"),
        edge: cellEl.getAttribute("edge"),
        style: cellEl.getAttribute("style"),
        value: cellEl.getAttribute("value"),
        source: cellEl.getAttribute("source"),
        target: cellEl.getAttribute("target"),
    }
}

/** Assert a parsed cell is not null (throws on failure) */
function p(xml: string, id: string) {
    const result = parseCell(xml, id)
    if (!result) throw new Error(`Cell ${id} not found`)
    return result
}

/** Check if two rectangles overlap */
function rectsOverlap(
    ax: number,
    ay: number,
    aw: number,
    ah: number,
    bx: number,
    by: number,
    bw: number,
    bh: number,
): boolean {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by
}

/** Calculate overlap area of two rectangles */
function overlapArea(
    ax: number,
    ay: number,
    aw: number,
    ah: number,
    bx: number,
    by: number,
    bw: number,
    bh: number,
): number {
    const overlapX = Math.max(0, Math.min(ax + aw, bx + bw) - Math.max(ax, bx))
    const overlapY = Math.max(0, Math.min(ay + ah, by + bh) - Math.max(ay, by))
    return overlapX * overlapY
}

// ============================================================================
// Test: 1. Same-level collision elimination
// ============================================================================

describe("applyAutoLayout - Same-level collision elimination", () => {
    it("3 overlapping nodes under same parent should have no collision after layout", () => {
        const xml = `<mxGraphModel><root>
<mxCell id="0"/>
<mxCell id="1" parent="0"/>
<mxCell id="container" vertex="1" parent="1" style="rounded=1;">
<mxGeometry x="0" y="0" width="500" height="500" as="geometry"/>
</mxCell>
<mxCell id="n1" vertex="1" parent="container" style="rounded=0;">
<mxGeometry x="50" y="50" width="80" height="60" as="geometry"/>
</mxCell>
<mxCell id="n2" vertex="1" parent="container" style="rounded=0;">
<mxGeometry x="55" y="55" width="80" height="60" as="geometry"/>
</mxCell>
<mxCell id="n3" vertex="1" parent="container" style="rounded=0;">
<mxGeometry x="60" y="60" width="80" height="60" as="geometry"/>
</mxCell>
</root></mxGraphModel>`

        const result = applyAutoLayout(xml)

        const n1 = p(result, "n1")
        const n2 = p(result, "n2")
        const n3 = p(result, "n3")

        // No collisions between any pair
        expect(
            overlapArea(n1.x, n1.y, n1.w, n1.h, n2.x, n2.y, n2.w, n2.h),
        ).toBe(0)
        expect(
            overlapArea(n1.x, n1.y, n1.w, n1.h, n3.x, n3.y, n3.w, n3.h),
        ).toBe(0)
        expect(
            overlapArea(n2.x, n2.y, n2.w, n2.h, n3.x, n3.y, n3.w, n3.h),
        ).toBe(0)
    })

    it("5 nodes split into 2 rows should have no within-row or between-row collisions", () => {
        const xml = `<mxGraphModel><root>
<mxCell id="0"/>
<mxCell id="1" parent="0"/>
<mxCell id="container" vertex="1" parent="1" style="rounded=1;">
<mxGeometry x="0" y="0" width="600" height="500" as="geometry"/>
</mxCell>
<mxCell id="n1" vertex="1" parent="container" style="rounded=0;">
<mxGeometry x="30" y="30" width="80" height="60" as="geometry"/>
</mxCell>
<mxCell id="n2" vertex="1" parent="container" style="rounded=0;">
<mxGeometry x="40" y="35" width="80" height="60" as="geometry"/>
</mxCell>
<mxCell id="n3" vertex="1" parent="container" style="rounded=0;">
<mxGeometry x="50" y="32" width="80" height="60" as="geometry"/>
</mxCell>
<mxCell id="n4" vertex="1" parent="container" style="rounded=0;">
<mxGeometry x="30" y="200" width="80" height="60" as="geometry"/>
</mxCell>
<mxCell id="n5" vertex="1" parent="container" style="rounded=0;">
<mxGeometry x="35" y="205" width="80" height="60" as="geometry"/>
</mxCell>
</root></mxGraphModel>`

        const result = applyAutoLayout(xml)

        const nodes = ["n1", "n2", "n3", "n4", "n5"].map((id) => p(result, id))

        // Check all pairs for no collision
        for (let i = 0; i < nodes.length; i++) {
            for (let j = i + 1; j < nodes.length; j++) {
                const a = nodes[i]
                const b = nodes[j]
                const overlap = overlapArea(
                    a.x,
                    a.y,
                    a.w,
                    a.h,
                    b.x,
                    b.y,
                    b.w,
                    b.h,
                )
                expect(overlap).toBe(0)
            }
        }
    })
})

// ============================================================================
// Test: 2. Row grouping correctness
// ============================================================================

describe("applyAutoLayout - Row grouping correctness", () => {
    it("3 nodes with similar y should be grouped in same row", () => {
        const xml = `<mxGraphModel><root>
<mxCell id="0"/>
<mxCell id="1" parent="0"/>
<mxCell id="container" vertex="1" parent="1" style="startSize=30;">
<mxGeometry x="0" y="0" width="500" height="300" as="geometry"/>
</mxCell>
<mxCell id="n1" vertex="1" parent="container" style="rounded=0;">
<mxGeometry x="30" y="50" width="80" height="60" as="geometry"/>
</mxCell>
<mxCell id="n2" vertex="1" parent="container" style="rounded=0;">
<mxGeometry x="200" y="55" width="80" height="60" as="geometry"/>
</mxCell>
<mxCell id="n3" vertex="1" parent="container" style="rounded=0;">
<mxGeometry x="400" y="48" width="80" height="60" as="geometry"/>
</mxCell>
</root></mxGraphModel>`

        const result = applyAutoLayout(xml)

        const n1 = p(result, "n1")
        const n2 = p(result, "n2")
        const n3 = p(result, "n3")

        // All in same row: y centers should be close to each other
        const centerY1 = n1.y + n1.h / 2
        const centerY2 = n2.y + n2.h / 2
        const centerY3 = n3.y + n3.h / 2
        expect(Math.abs(centerY1 - centerY2)).toBeLessThan(40)
        expect(Math.abs(centerY2 - centerY3)).toBeLessThan(40)

        // No overlap
        expect(
            overlapArea(n1.x, n1.y, n1.w, n1.h, n2.x, n2.y, n2.w, n2.h),
        ).toBe(0)
        expect(
            overlapArea(n2.x, n2.y, n2.w, n2.h, n3.x, n3.y, n3.w, n3.h),
        ).toBe(0)
    })

    it("3 nodes with large y gap should be in different rows", () => {
        const xml = `<mxGraphModel><root>
<mxCell id="0"/>
<mxCell id="1" parent="0"/>
<mxCell id="container" vertex="1" parent="1" style="startSize=30;">
<mxGeometry x="0" y="0" width="500" height="600" as="geometry"/>
</mxCell>
<mxCell id="n1" vertex="1" parent="container" style="rounded=0;">
<mxGeometry x="30" y="30" width="80" height="60" as="geometry"/>
</mxCell>
<mxCell id="n2" vertex="1" parent="container" style="rounded=0;">
<mxGeometry x="30" y="200" width="80" height="60" as="geometry"/>
</mxCell>
<mxCell id="n3" vertex="1" parent="container" style="rounded=0;">
<mxGeometry x="30" y="400" width="80" height="60" as="geometry"/>
</mxCell>
</root></mxGraphModel>`

        const result = applyAutoLayout(xml)

        const n1 = p(result, "n1")
        const n2 = p(result, "n2")
        const n3 = p(result, "n3")

        // Large y gap should keep them in separate rows
        const centerY1 = n1.y + n1.h / 2
        const centerY2 = n2.y + n2.h / 2
        const centerY3 = n3.y + n3.h / 2
        expect(Math.abs(centerY1 - centerY2)).toBeGreaterThan(50)
        expect(Math.abs(centerY2 - centerY3)).toBeGreaterThan(50)

        // No overlap at all
        expect(
            overlapArea(n1.x, n1.y, n1.w, n1.h, n2.x, n2.y, n2.w, n2.h),
        ).toBe(0)
        expect(
            overlapArea(n2.x, n2.y, n2.w, n2.h, n3.x, n3.y, n3.w, n3.h),
        ).toBe(0)
    })
})

// ============================================================================
// Test: 3. Nested containers
// ============================================================================

describe("applyAutoLayout - Nested containers", () => {
    it("Container A contains Container B contains nodes - B's internal nodes should have no collision", () => {
        const xml = `<mxGraphModel><root>
<mxCell id="0"/>
<mxCell id="1" parent="0"/>
<mxCell id="A" vertex="1" parent="1" style="startSize=30;">
<mxGeometry x="0" y="0" width="500" height="500" as="geometry"/>
</mxCell>
<mxCell id="B" vertex="1" parent="A" style="startSize=20;">
<mxGeometry x="30" y="30" width="200" height="200" as="geometry"/>
</mxCell>
<mxCell id="n1" vertex="1" parent="B" style="rounded=0;">
<mxGeometry x="20" y="20" width="60" height="50" as="geometry"/>
</mxCell>
<mxCell id="n2" vertex="1" parent="B" style="rounded=0;">
<mxGeometry x="25" y="25" width="60" height="50" as="geometry"/>
</mxCell>
</root></mxGraphModel>`

        const result = applyAutoLayout(xml)

        const n1 = p(result, "n1")
        const n2 = p(result, "n2")
        const B = p(result, "B")

        // B's internal nodes should have no collision
        expect(
            overlapArea(n1.x, n1.y, n1.w, n1.h, n2.x, n2.y, n2.w, n2.h),
        ).toBe(0)

        // B's size should be adapted to fit its children
        expect(B.w).toBeGreaterThanOrEqual(200)
        expect(B.h).toBeGreaterThanOrEqual(200)
    })

    it("Two-level nested container - deepest processed first", () => {
        const xml = `<mxGraphModel><root>
<mxCell id="0"/>
<mxCell id="1" parent="0"/>
<mxCell id="A" vertex="1" parent="1" style="startSize=30;">
<mxGeometry x="0" y="0" width="600" height="600" as="geometry"/>
</mxCell>
<mxCell id="B" vertex="1" parent="A" style="startSize=20;">
<mxGeometry x="30" y="30" width="300" height="300" as="geometry"/>
</mxCell>
<mxCell id="C" vertex="1" parent="B" style="startSize=15;">
<mxGeometry x="30" y="30" width="150" height="150" as="geometry"/>
</mxCell>
<mxCell id="n1" vertex="1" parent="C" style="rounded=0;">
<mxGeometry x="15" y="15" width="40" height="40" as="geometry"/>
</mxCell>
<mxCell id="n2" vertex="1" parent="C" style="rounded=0;">
<mxGeometry x="20" y="20" width="40" height="40" as="geometry"/>
</mxCell>
</root></mxGraphModel>`

        const result = applyAutoLayout(xml)

        const n1 = p(result, "n1")
        const n2 = p(result, "n2")

        // Deepest level nodes should have no collision
        expect(
            overlapArea(n1.x, n1.y, n1.w, n1.h, n2.x, n2.y, n2.w, n2.h),
        ).toBe(0)
    })
})

// ============================================================================
// Test: 4. Container size adaptation
// ============================================================================

describe("applyAutoLayout - Container size adaptation", () => {
    it("Container 100x100 with children at 200x150 boundary should expand to >= 230x210", () => {
        const xml = `<mxGraphModel><root>
<mxCell id="0"/>
<mxCell id="1" parent="0"/>
<mxCell id="container" vertex="1" parent="1" style="startSize=30;">
<mxGeometry x="0" y="0" width="100" height="100" as="geometry"/>
</mxCell>
<mxCell id="n1" vertex="1" parent="container" style="rounded=0;">
<mxGeometry x="30" y="30" width="200" height="150" as="geometry"/>
</mxCell>
</root></mxGraphModel>`

        const result = applyAutoLayout(xml)
        const container = p(result, "container")

        // neededW = (30+200) - 30 + 60 = 260, neededH = (30+150) - 30 + 60 = 240
        // Since current is 100x100, it should expand
        expect(container.w).toBeGreaterThanOrEqual(230)
        expect(container.h).toBeGreaterThanOrEqual(210)
    })

    it("Container 500x500 with children at 100x100 should stay 500x500 (no shrink)", () => {
        const xml = `<mxGraphModel><root>
<mxCell id="0"/>
<mxCell id="1" parent="0"/>
<mxCell id="container" vertex="1" parent="1" style="startSize=30;">
<mxGeometry x="0" y="0" width="500" height="500" as="geometry"/>
</mxCell>
<mxCell id="n1" vertex="1" parent="container" style="rounded=0;">
<mxGeometry x="30" y="30" width="100" height="100" as="geometry"/>
</mxCell>
</root></mxGraphModel>`

        const result = applyAutoLayout(xml)
        const container = p(result, "container")

        // Container should NOT shrink
        expect(container.w).toBe(500)
        expect(container.h).toBe(500)
    })
})

// ============================================================================
// Test: 5. Property invariance
// ============================================================================

describe("applyAutoLayout - Property invariance", () => {
    it("cell style, value, id, vertex, edge attributes should not change after layout", () => {
        const xml = `<mxGraphModel><root>
<mxCell id="0"/>
<mxCell id="1" parent="0"/>
<mxCell id="container" vertex="1" parent="1" value="My Container" style="rounded=1;fillColor=#ff0000;">
<mxGeometry x="0" y="0" width="500" height="500" as="geometry"/>
</mxCell>
<mxCell id="n1" vertex="1" parent="container" value="Node 1" style="rounded=0;fillColor=#00ff00;">
<mxGeometry x="50" y="50" width="80" height="60" as="geometry"/>
</mxCell>
<mxCell id="n2" vertex="1" parent="container" value="Node 2" style="ellipse=1;fillColor=#0000ff;">
<mxGeometry x="55" y="55" width="80" height="60" as="geometry"/>
</mxCell>
</root></mxGraphModel>`

        const before_n1 = p(xml, "n1")
        const before_n2 = p(xml, "n2")
        const before_container = p(xml, "container")

        const result = applyAutoLayout(xml)

        const after_n1 = p(result, "n1")
        const after_n2 = p(result, "n2")
        const after_container = p(result, "container")

        // style, value, id, vertex, edge should be unchanged
        expect(after_n1.style).toBe(before_n1.style)
        expect(after_n1.value).toBe(before_n1.value)
        expect(after_n1.vertex).toBe(before_n1.vertex)
        expect(after_n1.edge).toBe(before_n1.edge)

        expect(after_n2.style).toBe(before_n2.style)
        expect(after_n2.value).toBe(before_n2.value)
        expect(after_n2.vertex).toBe(before_n2.vertex)
        expect(after_n2.edge).toBe(before_n2.edge)

        expect(after_container.style).toBe(before_container.style)
        expect(after_container.value).toBe(before_container.value)
    })
})

// ============================================================================
// Test: 6. Edge cells not modified
// ============================================================================

describe("applyAutoLayout - Edge cells not modified", () => {
    it("edge type cells geometry should remain completely unchanged", () => {
        const xml = `<mxGraphModel><root>
<mxCell id="0"/>
<mxCell id="1" parent="0"/>
<mxCell id="n1" vertex="1" parent="1" style="rounded=0;">
<mxGeometry x="50" y="50" width="80" height="60" as="geometry"/>
</mxCell>
<mxCell id="n2" vertex="1" parent="1" style="rounded=0;">
<mxGeometry x="200" y="50" width="80" height="60" as="geometry"/>
</mxCell>
<mxCell id="e1" edge="1" parent="1" source="n1" target="n2" style="endArrow=classic;">
<mxGeometry x="0" y="0" width="0" height="0" as="geometry">
<mxPoint x="90" y="80" as="sourcePoint"/>
<mxPoint x="200" y="80" as="targetPoint"/>
</mxGeometry>
</mxCell>
</root></mxGraphModel>`

        const before_e1 = p(xml, "e1")

        const result = applyAutoLayout(xml)
        const after_e1 = p(result, "e1")

        // Edge geometry should be completely unchanged
        expect(after_e1.x).toBe(before_e1.x)
        expect(after_e1.y).toBe(before_e1.y)
        expect(after_e1.w).toBe(before_e1.w)
        expect(after_e1.h).toBe(before_e1.h)
        expect(after_e1.edge).toBe("1")
        expect(after_e1.source).toBe(before_e1.source)
        expect(after_e1.target).toBe(before_e1.target)
    })
})

// ============================================================================
// Test: 7. Empty chart
// ============================================================================

describe("applyAutoLayout - Empty chart", () => {
    it("empty XML should return original XML", () => {
        const xml = ""
        expect(applyAutoLayout(xml)).toBe(xml)
    })

    it("only root cells should return original XML", () => {
        const xml = `<mxGraphModel><root>
<mxCell id="0"/>
<mxCell id="1" parent="0"/>
</root></mxGraphModel>`

        const result = applyAutoLayout(xml)
        // Should return the XML (may have serialization differences but no cells modified)
        expect(result).toContain('id="0"')
        expect(result).toContain('id="1"')
    })
})

// ============================================================================
// Test: 8. Idempotency
// ============================================================================

describe("applyAutoLayout - Idempotency", () => {
    it("calling applyAutoLayout twice on same XML should produce same result", () => {
        const xml = `<mxGraphModel><root>
<mxCell id="0"/>
<mxCell id="1" parent="0"/>
<mxCell id="container" vertex="1" parent="1" style="startSize=30;">
<mxGeometry x="0" y="0" width="500" height="500" as="geometry"/>
</mxCell>
<mxCell id="n1" vertex="1" parent="container" style="rounded=0;">
<mxGeometry x="50" y="50" width="80" height="60" as="geometry"/>
</mxCell>
<mxCell id="n2" vertex="1" parent="container" style="rounded=0;">
<mxGeometry x="55" y="55" width="80" height="60" as="geometry"/>
</mxCell>
<mxCell id="n3" vertex="1" parent="container" style="rounded=0;">
<mxGeometry x="60" y="60" width="80" height="60" as="geometry"/>
</mxCell>
</root></mxGraphModel>`

        const first = applyAutoLayout(xml)
        const second = applyAutoLayout(first)

        expect(second).toBe(first)
    })

    it("idempotency with overlapping top-level nodes", () => {
        const xml = `<mxGraphModel><root>
<mxCell id="0"/>
<mxCell id="1" parent="0"/>
<mxCell id="n1" vertex="1" parent="1" style="rounded=0;">
<mxGeometry x="50" y="50" width="80" height="60" as="geometry"/>
</mxCell>
<mxCell id="n2" vertex="1" parent="1" style="rounded=0;">
<mxGeometry x="55" y="55" width="80" height="60" as="geometry"/>
</mxCell>
</root></mxGraphModel>`

        const first = applyAutoLayout(xml)
        const second = applyAutoLayout(first)

        expect(second).toBe(first)
    })
})

// ============================================================================
// Test: 9. Real-world complex architecture diagram scenario
// ============================================================================

describe("applyAutoLayout - Real-world complex architecture diagram", () => {
    it("1 top container with 4 children + 1 top container with 2 nested + 2 standalone + 3 edges", () => {
        const xml = `<mxGraphModel><root>
<mxCell id="0"/>
<mxCell id="1" parent="0"/>

<!-- Top Container A with 4 child nodes (some overlapping) -->
<mxCell id="A" vertex="1" parent="1" value="Container A" style="startSize=30;fillColor=#f5f5f5;">
<mxGeometry x="0" y="0" width="400" height="400" as="geometry"/>
</mxCell>
<mxCell id="a1" vertex="1" parent="A" value="Service 1" style="rounded=0;fillColor=#dae8fc;">
<mxGeometry x="30" y="50" width="100" height="60" as="geometry"/>
</mxCell>
<mxCell id="a2" vertex="1" parent="A" value="Service 2" style="rounded=0;fillColor=#dae8fc;">
<mxGeometry x="35" y="55" width="100" height="60" as="geometry"/>
</mxCell>
<mxCell id="a3" vertex="1" parent="A" value="Service 3" style="rounded=0;fillColor=#d5e8d4;">
<mxGeometry x="30" y="200" width="100" height="60" as="geometry"/>
</mxCell>
<mxCell id="a4" vertex="1" parent="A" value="Service 4" style="rounded=0;fillColor=#d5e8d4;">
<mxGeometry x="35" y="205" width="100" height="60" as="geometry"/>
</mxCell>

<!-- Top Container B with 2 nested containers -->
<mxCell id="B" vertex="1" parent="1" value="Container B" style="startSize=30;fillColor=#f5f5f5;">
<mxGeometry x="500" y="0" width="500" height="400" as="geometry"/>
</mxCell>
<mxCell id="B1" vertex="1" parent="B" value="Sub B1" style="startSize=20;fillColor=#e6e6e6;">
<mxGeometry x="30" y="30" width="200" height="150" as="geometry"/>
</mxCell>
<mxCell id="B2" vertex="1" parent="B" value="Sub B2" style="startSize=20;fillColor=#e6e6e6;">
<mxGeometry x="30" y="220" width="200" height="150" as="geometry"/>
</mxCell>

<!-- Nodes inside nested containers -->
<mxCell id="b1n1" vertex="1" parent="B1" value="Node B1-1" style="rounded=0;">
<mxGeometry x="20" y="20" width="80" height="50" as="geometry"/>
</mxCell>
<mxCell id="b1n2" vertex="1" parent="B1" value="Node B1-2" style="rounded=0;">
<mxGeometry x="25" y="25" width="80" height="50" as="geometry"/>
</mxCell>
<mxCell id="b2n1" vertex="1" parent="B2" value="Node B2-1" style="rounded=0;">
<mxGeometry x="20" y="20" width="80" height="50" as="geometry"/>
</mxCell>
<mxCell id="b2n2" vertex="1" parent="B2" value="Node B2-2" style="rounded=0;">
<mxGeometry x="25" y="25" width="80" height="50" as="geometry"/>
</mxCell>

<!-- 2 standalone top-level nodes -->
<mxCell id="s1" vertex="1" parent="1" value="Standalone 1" style="ellipse=1;fillColor=#fff2cc;">
<mxGeometry x="1050" y="50" width="80" height="80" as="geometry"/>
</mxCell>
<mxCell id="s2" vertex="1" parent="1" value="Standalone 2" style="ellipse=1;fillColor=#fff2cc;">
<mxGeometry x="1060" y="60" width="80" height="80" as="geometry"/>
</mxCell>

<!-- 3 edges -->
<mxCell id="edge1" edge="1" parent="1" source="a1" target="a3" style="endArrow=classic;">
<mxGeometry x="0" y="0" width="0" height="0" as="geometry">
<mxPoint x="80" y="110" as="sourcePoint"/>
<mxPoint x="80" y="200" as="targetPoint"/>
</mxGeometry>
</mxCell>
<mxCell id="edge2" edge="1" parent="1" source="s1" target="A" style="endArrow=classic;">
<mxGeometry x="0" y="0" width="0" height="0" as="geometry">
<mxPoint x="1050" y="90" as="sourcePoint"/>
<mxPoint x="400" y="200" as="targetPoint"/>
</mxGeometry>
</mxCell>
<mxCell id="edge3" edge="1" parent="1" source="a4" target="s2" style="endArrow=classic;">
<mxGeometry x="0" y="0" width="0" height="0" as="geometry">
<mxPoint x="130" y="260" as="sourcePoint"/>
<mxPoint x="1060" y="100" as="targetPoint"/>
</mxGeometry>
</mxCell>
</root></mxGraphModel>`

        const result = applyAutoLayout(xml)

        // --- Check: All sibling nodes within same container have no collision ---

        // Container A children
        const a1 = p(result, "a1")
        const a2 = p(result, "a2")
        const a3 = p(result, "a3")
        const a4 = p(result, "a4")

        const aNodes = [a1, a2, a3, a4]
        for (let i = 0; i < aNodes.length; i++) {
            for (let j = i + 1; j < aNodes.length; j++) {
                const overlap = overlapArea(
                    aNodes[i].x,
                    aNodes[i].y,
                    aNodes[i].w,
                    aNodes[i].h,
                    aNodes[j].x,
                    aNodes[j].y,
                    aNodes[j].w,
                    aNodes[j].h,
                )
                expect(
                    overlap,
                    `Container A: overlap between a${i + 1} and a${j + 1}`,
                ).toBe(0)
            }
        }

        // B1 children
        const b1n1 = p(result, "b1n1")
        const b1n2 = p(result, "b1n2")
        expect(
            overlapArea(
                b1n1.x,
                b1n1.y,
                b1n1.w,
                b1n1.h,
                b1n2.x,
                b1n2.y,
                b1n2.w,
                b1n2.h,
            ),
            "B1: overlap between b1n1 and b1n2",
        ).toBe(0)

        // B2 children
        const b2n1 = p(result, "b2n1")
        const b2n2 = p(result, "b2n2")
        expect(
            overlapArea(
                b2n1.x,
                b2n1.y,
                b2n1.w,
                b2n1.h,
                b2n2.x,
                b2n2.y,
                b2n2.w,
                b2n2.h,
            ),
            "B2: overlap between b2n1 and b2n2",
        ).toBe(0)

        // Standalone top-level nodes
        const s1 = p(result, "s1")
        const s2 = p(result, "s2")
        expect(
            overlapArea(s1.x, s1.y, s1.w, s1.h, s2.x, s2.y, s2.w, s2.h),
            "Standalone: overlap between s1 and s2",
        ).toBe(0)

        // --- Check: Container sizes are correct ---
        const A = p(result, "A")
        expect(A.w, "Container A width").toBeGreaterThanOrEqual(400)
        expect(A.h, "Container A height").toBeGreaterThanOrEqual(400)

        const B = p(result, "B")
        expect(B.w, "Container B width").toBeGreaterThanOrEqual(500)
        expect(B.h, "Container B height").toBeGreaterThanOrEqual(400)

        // --- Check: Edges are unchanged ---
        const before_edge1 = p(xml, "edge1")
        const after_edge1 = p(result, "edge1")
        expect(after_edge1.x, "edge1 x").toBe(before_edge1.x)
        expect(after_edge1.y, "edge1 y").toBe(before_edge1.y)

        const before_edge2 = p(xml, "edge2")
        const after_edge2 = p(result, "edge2")
        expect(after_edge2.x, "edge2 x").toBe(before_edge2.x)
        expect(after_edge2.y, "edge2 y").toBe(before_edge2.y)

        const before_edge3 = p(xml, "edge3")
        const after_edge3 = p(result, "edge3")
        expect(after_edge3.x, "edge3 x").toBe(before_edge3.x)
        expect(after_edge3.y, "edge3 y").toBe(before_edge3.y)
    })
})

// ============================================================================
// Test: 10. Gap verification (adjacent siblings should have >= 30px gap)
// ============================================================================

describe("applyAutoLayout - Gap verification", () => {
    it("sibling nodes in same row after layout should have >= 30px horizontal gap", () => {
        const xml = `<mxGraphModel><root>
<mxCell id="0"/>
<mxCell id="1" parent="0"/>
<mxCell id="container" vertex="1" parent="1" style="startSize=30;">
<mxGeometry x="0" y="0" width="600" height="300" as="geometry"/>
</mxCell>
<mxCell id="n1" vertex="1" parent="container" style="rounded=0;">
<mxGeometry x="30" y="40" width="80" height="60" as="geometry"/>
</mxCell>
<mxCell id="n2" vertex="1" parent="container" style="rounded=0;">
<mxGeometry x="35" y="45" width="80" height="60" as="geometry"/>
</mxCell>
<mxCell id="n3" vertex="1" parent="container" style="rounded=0;">
<mxGeometry x="40" y="42" width="80" height="60" as="geometry"/>
</mxCell>
</root></mxGraphModel>`

        const result = applyAutoLayout(xml)

        const n1 = p(result, "n1")
        const n2 = p(result, "n2")
        const n3 = p(result, "n3")

        // Sort by x to find adjacent pairs
        const sorted = [n1, n2, n3].sort((a, b) => a.x - b.x)

        // Adjacent nodes should have >= 30px gap
        for (let i = 0; i < sorted.length - 1; i++) {
            const gap = sorted[i + 1].x - (sorted[i].x + sorted[i].w)
            expect(
                gap,
                `Horizontal gap between adjacent nodes ${i} and ${i + 1}`,
            ).toBeGreaterThanOrEqual(30)
        }
    })
})
