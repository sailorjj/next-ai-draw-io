/**
 * Draw.io XML Parser
 * 用于解析 Draw.io 模板文件，提取结构化信息
 */

import { DOMParser } from "@xmldom/xmldom"

export interface Point {
    x: number
    y: number
}

export interface Size {
    width: number
    height: number
}

export interface Geometry {
    x?: number
    y?: number
    width?: number
    height?: number
    relative?: number
    as?: string
    points?: Point[]
}

export interface CellStyle {
    // Layout
    swimlane?: boolean
    childLayout?: string
    horizontal?: number
    horizontalStack?: number
    startSize?: number

    // Shape
    shape?: string
    whiteSpace?: string
    html?: number
    rounded?: number | boolean

    // Styling
    strokeWidth?: number
    fontFamily?: string
    fontSize?: number
    align?: string
    fillColor?: string
    strokeColor?: string

    // Edge
    edgeStyle?: string
    startArrow?: string
    endArrow?: string
    entryX?: number
    entryY?: number
    exitX?: number
    exitY?: number
    jettySize?: string
    orthogonalLoop?: number
}

export interface PoolInfo {
    id: string
    value: string
    geometry: Geometry
    style: CellStyle
    lanes: LaneInfo[]
}

export interface LaneInfo {
    id: string
    parentId: string
    value: string
    geometry: Geometry
    style: CellStyle
}

export interface NodeInfo {
    id: string
    parentId: string
    value: string
    geometry: Geometry
    style: CellStyle
}

export interface EdgeInfo {
    id: string
    source: string
    target: string
    value?: string
    geometry: Geometry
    style: CellStyle
}

export interface ParsedTemplate {
    pools: PoolInfo[]
    lanes: LaneInfo[]
    nodes: NodeInfo[]
    edges: EdgeInfo[]
    rawXml: string
}

/**
 * 解析 Draw.io XML 模板文件
 */
export function parseDrawioTemplate(xmlString: string): ParsedTemplate {
    if (!xmlString || typeof xmlString !== "string") {
        throw new Error("Invalid input: xmlString must be a non-empty string")
    }

    if (!xmlString.includes("mxfile")) {
        throw new Error("Invalid Draw.io XML: missing mxfile root element")
    }

    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlString, "text/xml")

    // 检查解析错误
    const parseError = doc.getElementsByTagName("parsererror")
    if (parseError.length > 0) {
        throw new Error(`XML Parse Error: ${parseError[0].textContent}`)
    }

    // 获取 mxGraphModel
    const mxGraphModel = doc.getElementsByTagName("mxGraphModel")[0]
    if (!mxGraphModel) {
        throw new Error("Invalid Draw.io XML: missing mxGraphModel")
    }

    const root = mxGraphModel.getElementsByTagName("root")[0]
    if (!root) {
        throw new Error("Invalid Draw.io XML: missing root")
    }

    const allCells = root.getElementsByTagName("mxCell")

    const result: ParsedTemplate = {
        pools: [],
        lanes: [],
        nodes: [],
        edges: [],
        rawXml: xmlString,
    }

    // 第一遍：收集所有 ID 到 Cell 的映射
    const cellMap = new Map<string, any>()
    for (let i = 0; i < allCells.length; i++) {
        const cell = allCells[i]
        const id = cell.getAttribute("id")
        if (id) {
            cellMap.set(id, cell)
        }
    }

    // 第二遍：分类处理
    for (let i = 0; i < allCells.length; i++) {
        const cell = allCells[i]
        const id = cell.getAttribute("id")
        const parent = cell.getAttribute("parent")
        const styleStr = cell.getAttribute("style") || ""
        const value = cell.getAttribute("value") || ""
        const style = parseStyle(styleStr)
        const geometry = parseGeometry(cell)

        // 跳过根节点
        if (!id || id === "0" || id === "1") continue

        // 判断类型
        const isVertex = cell.getAttribute("vertex") === "1"
        const isEdge = cell.getAttribute("edge") === "1"
        const isSwimlane = style.swimlane === true

        // 区分Pool和Lane：Pool的parent是"1"，Lane的parent是Pool
        // 注意：某些模板（如矩阵模板）可能没有明确的Pool定义，都作为Pool处理
        if (isSwimlane) {
            // 检查parent是否是另一个swimlane（是的话就是Lane）
            if (parent && parent !== "1" && cellMap.has(parent)) {
                const parentCell = cellMap.get(parent)
                if (parentCell) {
                    const parentStyle = parseStyle(
                        parentCell.getAttribute("style") || "",
                    )
                    if (parentStyle.swimlane) {
                        // parent也是swimlane，说明这个是Lane
                        const lane: LaneInfo = {
                            id,
                            parentId: parent,
                            value,
                            geometry,
                            style,
                        }
                        result.lanes.push(lane)

                        // 关联到Pool（如果parent已经被识别为Pool）
                        const pool = result.pools.find((p) => p.id === parent)
                        if (pool) {
                            pool.lanes.push(lane)
                        }
                    } else {
                        // parent不是swimlane，作为Pool处理
                        const pool: PoolInfo = {
                            id,
                            value,
                            geometry,
                            style,
                            lanes: [],
                        }
                        result.pools.push(pool)
                    }
                }
            } else {
                // 直接挂在根节点下或没有有效parent，作为Pool处理
                const pool: PoolInfo = {
                    id,
                    value,
                    geometry,
                    style,
                    lanes: [],
                }
                result.pools.push(pool)
            }
        } else if (isVertex) {
            // 节点
            // 判断逻辑：
            // - 如果 style 本身包含 swimlane，且 parent 是 Pool，则是 Lane
            // - 如果 style 不包含 swimlane，即使 parent 是 Lane，也只是普通节点
            if (style.swimlane === true) {
                // 自身是 swimlane，检查 parent
                if (parent && cellMap.has(parent)) {
                    const parentCell = cellMap.get(parent)
                    if (parentCell) {
                        const parentStyle = parseStyle(
                            parentCell.getAttribute("style") || "",
                        )
                        if (parentStyle.swimlane) {
                            // parent也是swimlane，说明这个是Lane
                            const lane: LaneInfo = {
                                id,
                                parentId: parent,
                                value,
                                geometry,
                                style,
                            }
                            result.lanes.push(lane)

                            // 关联到Pool
                            const pool = result.pools.find(
                                (p) => p.id === parent,
                            )
                            if (pool) {
                                pool.lanes.push(lane)
                            }
                            continue // 已处理，继续下一个
                        }
                    }
                }
                // 没有有效parent或parent不是swimlane，作为Pool处理
                const pool: PoolInfo = {
                    id,
                    value,
                    geometry,
                    style,
                    lanes: [],
                }
                result.pools.push(pool)
            } else {
                // 自身不是swimlane，就是普通节点
                result.nodes.push({
                    id: id || "",
                    parentId: parent || "",
                    value,
                    geometry,
                    style,
                })
            }
        } else if (isEdge) {
            // 边
            result.edges.push({
                id,
                source: cell.getAttribute("source") || "",
                target: cell.getAttribute("target") || "",
                value: cell.getAttribute("value") || undefined,
                geometry,
                style,
            })
        }
    }

    return result
}

/**
 * 解析 style 字符串为对象
 */
function parseStyle(styleStr: string): CellStyle {
    const style: CellStyle = {}
    if (!styleStr) return style

    const parts = styleStr.split(";")
    for (const part of parts) {
        // 处理独立的属性（如 swimplane, html 等没有 = 的情况）
        const trimmedPart = part.trim()
        if (trimmedPart === "swimlane") {
            style.swimlane = true
            continue
        }
        if (!trimmedPart) continue
        const equalIndex = trimmedPart.indexOf("=")
        if (equalIndex === -1) continue

        const key = trimmedPart.substring(0, equalIndex)
        const value = trimmedPart.substring(equalIndex + 1)
        if (!key) continue

        switch (key) {
            case "swimlane":
                style.swimlane = value === "1"
                break
            case "childLayout":
                style.childLayout = value
                break
            case "horizontal":
                style.horizontal = parseInt(value, 10)
                break
            case "horizontalStack":
                style.horizontalStack = parseInt(value, 10)
                break
            case "startSize":
                style.startSize = parseInt(value, 10)
                break
            case "shape":
                style.shape = value
                break
            case "whiteSpace":
                style.whiteSpace = value
                break
            case "html":
                style.html = parseInt(value, 10)
                break
            case "rounded":
                style.rounded =
                    value === "1" ? 1 : value === "0" ? 0 : parseInt(value, 10)
                break
            case "strokeWidth":
                style.strokeWidth = parseInt(value, 10)
                break
            case "fontFamily":
                style.fontFamily = value
                break
            case "fontSize":
                style.fontSize = parseInt(value, 10)
                break
            case "align":
                style.align = value
                break
            case "fillColor":
                style.fillColor = value
                break
            case "strokeColor":
                style.strokeColor = value
                break
            case "edgeStyle":
                style.edgeStyle = value
                break
            case "startArrow":
                style.startArrow = value
                break
            case "endArrow":
                style.endArrow = value
                break
            case "entryX":
                style.entryX = parseFloat(value)
                break
            case "entryY":
                style.entryY = parseFloat(value)
                break
            case "exitX":
                style.exitX = parseFloat(value)
                break
            case "exitY":
                style.exitY = parseFloat(value)
                break
            case "jettySize":
                style.jettySize = value
                break
            case "orthogonalLoop":
                style.orthogonalLoop = parseInt(value, 10)
                break
        }
    }

    return style
}

/**
 * 解析 geometry
 */
function parseGeometry(cell: any): Geometry {
    const geo = cell.getElementsByTagName("mxGeometry")[0]
    if (!geo) return {}

    return {
        x: geo.hasAttribute("x")
            ? parseFloat(geo.getAttribute("x") || "0")
            : undefined,
        y: geo.hasAttribute("y")
            ? parseFloat(geo.getAttribute("y") || "0")
            : undefined,
        width: geo.hasAttribute("width")
            ? parseFloat(geo.getAttribute("width") || "0")
            : undefined,
        height: geo.hasAttribute("height")
            ? parseFloat(geo.getAttribute("height") || "0")
            : undefined,
        relative: geo.hasAttribute("relative")
            ? parseInt(geo.getAttribute("relative") || "0", 10)
            : undefined,
        as: geo.getAttribute("as") || undefined,
    }
}

/**
 * 将结构化数据转换回 Draw.io XML（纯字符串方式）
 */
export function generateDrawioXml(template: ParsedTemplate): string {
    let xml = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="jgraph.github.io">
  <diagram name="Page-1" id="diagram-1">
    <mxGraphModel dx="1046" dy="740" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="827" pageHeight="1169">
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
`

    let idCounter = 2
    const idMap = new Map<string, string>()

    // 添加 Pools
    for (const pool of template.pools) {
        const poolId = pool.id || `pool-${idCounter++}`
        idMap.set(pool.id || "", poolId)

        xml += `        <mxCell id="${poolId}" parent="1" style="${escapeXml(serializeStyle(pool.style))}" value="${escapeXml(pool.value)}" vertex="1">
          <mxGeometry x="${pool.geometry.x || 0}" y="${pool.geometry.y || 0}" width="${pool.geometry.width || 800}" height="${pool.geometry.height || 600}" as="geometry" />
        </mxCell>
`

        // 添加 Lanes
        for (const lane of pool.lanes) {
            const laneId = lane.id || `lane-${idCounter++}`
            idMap.set(lane.id || "", laneId)

            xml += `        <mxCell id="${laneId}" parent="${poolId}" style="${escapeXml(serializeStyle(lane.style))}" value="${escapeXml(lane.value)}" vertex="1">
          <mxGeometry x="${lane.geometry.x || 0}" y="${lane.geometry.y || 0}" width="${lane.geometry.width || 800}" height="${lane.geometry.height || 150}" as="geometry" />
        </mxCell>
`

            // 添加节点
            const laneNodes = template.nodes.filter(
                (n) => n.parentId === lane.id,
            )
            for (const node of laneNodes) {
                const nodeId = node.id || `node-${idCounter++}`
                idMap.set(node.id || "", nodeId)

                xml += `        <mxCell id="${nodeId}" parent="${laneId}" style="${escapeXml(serializeStyle(node.style))}" value="${escapeXml(node.value)}" vertex="1">
          <mxGeometry x="${node.geometry.x || 0}" y="${node.geometry.y || 0}" width="${node.geometry.width || 70}" height="${node.geometry.height || 37}" as="geometry" />
        </mxCell>
`
            }
        }
    }

    // 添加独立节点（不在泳道内的）
    const orphanNodes = template.nodes.filter((n) => {
        const parent = template.pools.find((p) => p.id === n.parentId)
        const lane = template.lanes.find((l) => l.id === n.parentId)
        return !parent && !lane
    })
    for (const node of orphanNodes) {
        const nodeId = node.id || `node-${idCounter++}`
        idMap.set(node.id || "", nodeId)

        xml += `        <mxCell id="${nodeId}" parent="1" style="${escapeXml(serializeStyle(node.style))}" value="${escapeXml(node.value)}" vertex="1">
          <mxGeometry x="${node.geometry.x || 0}" y="${node.geometry.y || 0}" width="${node.geometry.width || 70}" height="${node.geometry.height || 37}" as="geometry" />
        </mxCell>
`
    }

    // 添加边
    for (const edge of template.edges) {
        const sourceId = idMap.get(edge.source) || edge.source
        const targetId = idMap.get(edge.target) || edge.target
        const edgeId = edge.id || `edge-${idCounter++}`

        xml += `        <mxCell id="${edgeId}" parent="1" source="${sourceId}" target="${targetId}" style="${escapeXml(serializeStyle(edge.style))}"${edge.value ? ` value="${escapeXml(edge.value)}"` : ""} edge="1">
          <mxGeometry relative="1" as="geometry" />
        </mxCell>\n`
    }

    xml += `      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`

    return xml
}

/**
 * 转义 XML 特殊字符
 */
function escapeXml(str: string): string {
    return str
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&apos;")
}

/**
 * 将样式对象序列化为字符串
 */
function serializeStyle(style: CellStyle): string {
    const parts: string[] = []

    if (style.swimlane !== undefined)
        parts.push(`swimlane=${style.swimlane ? 1 : 0}`)
    if (style.childLayout) parts.push(`childLayout=${style.childLayout}`)
    if (style.horizontal !== undefined)
        parts.push(`horizontal=${style.horizontal}`)
    if (style.horizontalStack !== undefined)
        parts.push(`horizontalStack=${style.horizontalStack}`)
    if (style.startSize !== undefined)
        parts.push(`startSize=${style.startSize}`)
    if (style.shape) parts.push(`shape=${style.shape}`)
    if (style.whiteSpace) parts.push(`whiteSpace=${style.whiteSpace}`)
    if (style.html !== undefined) parts.push(`html=${style.html}`)
    if (style.rounded !== undefined) parts.push(`rounded=${style.rounded}`)
    if (style.strokeWidth !== undefined)
        parts.push(`strokeWidth=${style.strokeWidth}`)
    if (style.fontFamily) parts.push(`fontFamily=${style.fontFamily}`)
    if (style.fontSize !== undefined) parts.push(`fontSize=${style.fontSize}`)
    if (style.align) parts.push(`align=${style.align}`)
    if (style.fillColor) parts.push(`fillColor=${style.fillColor}`)
    if (style.strokeColor) parts.push(`strokeColor=${style.strokeColor}`)
    if (style.edgeStyle) parts.push(`edgeStyle=${style.edgeStyle}`)
    if (style.startArrow) parts.push(`startArrow=${style.startArrow}`)
    if (style.endArrow) parts.push(`endArrow=${style.endArrow}`)
    if (style.entryX !== undefined) parts.push(`entryX=${style.entryX}`)
    if (style.entryY !== undefined) parts.push(`entryY=${style.entryY}`)
    if (style.exitX !== undefined) parts.push(`exitX=${style.exitX}`)
    if (style.exitY !== undefined) parts.push(`exitY=${style.exitY}`)
    if (style.jettySize) parts.push(`jettySize=${style.jettySize}`)
    if (style.orthogonalLoop !== undefined)
        parts.push(`orthogonalLoop=${style.orthogonalLoop}`)

    return parts.join(";")
}
