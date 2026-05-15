import { parseDrawioTemplate } from "./drawio-parser"
import { parseStyleTemplate } from "./style-parser"

export interface ProcessedTemplate {
    diagramTemplateName: string
    diagramXml: string

    // 样式模板信息
    styleTemplateName?: string
    styleContent?: string

    // 提取的布局结构
    layout: {
        poolStyle: string // Pool的完整style属性
        laneStyles: string[] // Lane的完整style属性数组
        idParentMap: { id: string; parent: string; value: string }[] // ID-parent关系
        poolId: string
        laneIds: string[]
    }

    // 提取的节点信息（不含swimlane的节点）
    nodes: {
        id: string
        value: string
        parentId: string
        shape?: string
    }[]

    // 提取的边信息（判断节点的连线）
    edges: {
        id: string
        source: string
        target: string
        value?: string // 判断分支：Yes/No
        style: string
    }[]

    // 样式变量替换
    styleVariables: {
        name: string
        value: string
    }[]

    // 精简但完整的XML结构参考（已替换颜色变量）
    xmlStructure: string

    // 摘要
    summary: string
}

/**
 * 样式变量替换函数
 */
function replaceStyleVariables(
    style: string,
    variables: Record<string, string>,
): string {
    let result = style
    Object.entries(variables).forEach(([name, value]) => {
        // 替换 {name} 为具体颜色值
        result = result.replace(new RegExp(`\\{${name}\\}`, "g"), value)
    })
    return result
}

/**
 * 前处理程序：从模板文件生成精简的模板信息
 */
export function preprocessTemplate(
    diagramXml: string,
    diagramName: string,
    styleMd?: string,
    styleName?: string,
): ProcessedTemplate {
    const template = parseDrawioTemplate(diagramXml)

    // 解析样式模板，提取颜色变量
    let colorVariables: Record<string, string> = {}
    if (styleMd) {
        const parsedStyle = parseStyleTemplate(styleMd)
        if (parsedStyle.colors) {
            colorVariables = parsedStyle.colors
        }
    }

    // 提取Pool的完整Style
    const pool = template.pools[0]
    const poolId = pool?.id || "pool-0"
    let poolStyle = pool?.style
        ? Object.entries(pool.style)
              .filter(([key]) => key !== "swimlane") // 去掉swimlane标记，在xml中已包含
              .map(([key, val]) => `${key}=${val}`)
              .join(";")
        : "horizontal=1;startSize=20"

    // 替换颜色变量
    poolStyle = replaceStyleVariables(poolStyle, colorVariables)

    // 提取Lane的完整Style
    const laneIds: string[] = []
    const laneStyles: string[] = []
    template.lanes.forEach((lane, idx) => {
        const laneId = lane.id || `lane-${idx}`
        laneIds.push(laneId)

        // 获取Lane的完整style
        let laneStyle = lane.style
            ? Object.entries(lane.style)
                  .filter(([key]) => key !== "swimlane")
                  .map(([key, val]) => `${key}=${val}`)
                  .join(";")
            : "horizontal=0;startSize=20"

        // 替换颜色变量
        laneStyle = replaceStyleVariables(laneStyle, colorVariables)
        laneStyles.push(laneStyle)
    })

    // 记录ID-parent关系（用于理解结构）
    const idParentMap = [
        { id: "0", parent: "", value: "" },
        { id: "1", parent: "0", value: "" },
        { id: poolId, parent: "1", value: pool?.value || "流程图" },
        ...template.lanes.map((lane, idx) => ({
            id: lane.id || `lane-${idx}`,
            parent: poolId,
            value: lane.value,
        })),
    ]

    // 生成精简XML结构参考（包含Pool/Lane框架 + 节点/连线示例）
    const poolXml = `<mxCell id="${poolId}" value="..." style="swimlane;${poolStyle}" vertex="1" parent="1">
  <mxGeometry x="40" y="40" width="1000" height="${(template.lanes.length || 1) * 100 + 40}" as="geometry"/>
</mxCell>`

    const lanesXml = template.lanes
        .map((lane, idx) => {
            const laneId = lane.id || `lane-${idx}`
            const y = 20 + idx * 100
            return `<mxCell id="${laneId}" value="${lane.value || "泳道" + (idx + 1)}" style="swimlane;${laneStyles[idx] || "horizontal=0"}" vertex="1" parent="${poolId}">
  <mxGeometry y="${y}" width="1000" height="100" as="geometry"/>
</mxCell>`
        })
        .join("\n")

    // 节点示例（取前3个作为示例）
    const sampleNodes = template.nodes
        .slice(0, 3)
        .map((node) => {
            const shape = node.style.shape
                ? `shape=${node.style.shape}`
                : "rounded=1;whiteSpace=wrap"
            const fillColor = node.style.fillColor
                ? `fillColor=${node.style.fillColor}`
                : ""
            const style = [shape, fillColor].filter(Boolean).join(";")
            return `<mxCell id="${node.id}" value="${node.value}" style="${style}" vertex="1" parent="${node.parentId}">
  <mxGeometry x="60" y="30" width="70" height="37" as="geometry"/>
</mxCell>`
        })
        .join("\n")

    // 连线示例（取前3条作为示例，特别是判断分支）
    const sampleEdges = template.edges
        .slice(0, 3)
        .map((edge) => {
            const valueAttr = edge.value ? ` value="${edge.value}"` : ""
            return `<mxCell id="${edge.id}" style="edgeStyle=orthogonalEdgeStyle;endArrow=classic;html=1;"${valueAttr} edge="1" parent="${poolId}" source="${edge.source}" target="${edge.target}">
  <mxGeometry relative="1" as="geometry"/>
</mxCell>`
        })
        .join("\n")

    // 完整结构：包含Pool/Lane框架 + 节点/连线示例
    const xmlStructure = `<?xml version="1.0" encoding="UTF-8"?>
<mxfile host="app.diagrams.net">
  <diagram>
    <mxGraphModel>
      <root>
        <mxCell id="0" />
        <mxCell id="1" parent="0" />
${poolXml}
${lanesXml}
${sampleNodes}
${sampleEdges}
      </root>
    </mxGraphModel>
  </diagram>
</mxfile>`

    // 提取Pool的horizontal属性用于摘要
    const horizontal = pool?.style?.horizontal ?? 1
    const childLayout = pool?.style?.childLayout || "stackLayout"
    const horizontalStack = pool?.style?.horizontalStack ?? 0
    const stackDesc = horizontalStack === 1 ? "水平" : "垂直"

    const summary = `${horizontal === 1 ? "横向" : "竖向"}泳道(childLayout=${childLayout}, ${stackDesc}排列)，${template.lanes.length}个泳道`

    // 样式变量
    const styleVariables = Object.entries(colorVariables).map(
        ([name, value]) => ({
            name: `{${name}}`,
            value,
        }),
    )

    // 提取节点信息（不含swimlane的节点）
    const nodes = template.nodes.map((node) => ({
        id: node.id,
        value: node.value,
        parentId: node.parentId,
        shape: node.style.shape,
    }))

    // 提取边信息（判断节点的连线，包含Yes/No分支）
    const edges = template.edges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        value: edge.value, // Yes/No 分支标签
        style: edge.style
            ? Object.entries(edge.style)
                  .map(([key, val]) => `${key}=${val}`)
                  .join(";")
            : "",
    }))

    return {
        diagramTemplateName: diagramName,
        diagramXml,
        styleTemplateName: styleName,
        styleContent: styleMd,
        layout: {
            poolStyle,
            laneStyles,
            idParentMap,
            poolId,
            laneIds,
        },
        nodes,
        edges,
        styleVariables,
        xmlStructure,
        summary,
    }
}

/**
 * 生成发送给AI的精简文本
 */
export function generatePromptFromProcessed(
    processed: ProcessedTemplate,
): string {
    const parts: string[] = []

    parts.push("--- 模板信息 ---")
    parts.push(`图表模板: ${processed.diagramTemplateName}`)
    parts.push(`布局摘要: ${processed.summary}`)

    // Pool的Style属性（不包含swimlane，因为XML标签已说明）
    parts.push(`\nPool Style属性: ${processed.layout.poolStyle}`)

    // Lane的Style属性
    parts.push(`\nLane Style属性 (按顺序):`)
    processed.layout.laneStyles.forEach((style, idx) => {
        parts.push(`  Lane ${idx + 1}: ${style}`)
    })

    // ID-parent关系
    parts.push(`\nID-Parent结构 (泳道框架):`)
    processed.layout.idParentMap.forEach((m) => {
        if (m.id && m.parent) {
            parts.push(`  ${m.id} -> parent:${m.parent} (${m.value})`)
        }
    })

    // 节点信息
    if (processed.nodes.length > 0) {
        parts.push(`\n节点列表 (共${processed.nodes.length}个):`)
        processed.nodes.forEach((node) => {
            const shapeInfo = node.shape ? `shape=${node.shape}` : "无shape"
            parts.push(
                `  ${node.id}: "${node.value}" parent=${node.parentId} (${shapeInfo})`,
            )
        })
    }

    // 边信息（判断连线）
    if (processed.edges.length > 0) {
        parts.push(`\n连线/判断分支 (共${processed.edges.length}条):`)
        processed.edges.forEach((edge) => {
            const branchLabel = edge.value ? ` [${edge.value}]` : ""
            parts.push(
                `  ${edge.id}: ${edge.source} -> ${edge.target}${branchLabel}`,
            )
        })
    }

    // 样式变量
    if (processed.styleVariables.length > 0) {
        parts.push(`\n样式变量替换:`)
        processed.styleVariables.forEach((s) => {
            parts.push(`  ${s.name} = ${s.value}`)
        })
    }

    // 重要说明
    parts.push(`\n⚠️ 重要说明:`)
    parts.push(`- Pool和Lane的style需要加"swimlane;"前缀`)
    parts.push(`- 普通节点（如S/E/判断/流程节点）的style不需要"swimlane"前缀`)
    parts.push(
        `- 判断节点使用shape=mxgraph.flowchart.decision，连线用value="Yes"/"No"标记分支`,
    )
    parts.push(
        `- 连线使用edgeStyle=orthogonalEdgeStyle，source和target指向正确的节点ID`,
    )

    // 精简XML结构参考（包含节点和连线示例）
    parts.push(`\nXML结构参考 (Pool/Lane框架 + 节点/连线示例):`)
    parts.push(processed.xmlStructure)

    parts.push("---")

    return parts.join("\n")
}
