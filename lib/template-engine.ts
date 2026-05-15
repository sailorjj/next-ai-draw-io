/**
 * Template Application Engine
 * 将解析的模板应用到新图表生成
 */

import {
    type EdgeInfo,
    generateDrawioXml,
    type NodeInfo,
    type ParsedTemplate,
    parseDrawioTemplate,
} from "./drawio-parser"
import {
    applyStyleToNode,
    type ParsedStyleTemplate,
    parseStyleTemplate,
} from "./style-parser"

export interface BusinessNode {
    id: string
    label: string
    laneId?: string
    shape?: string
    metadata?: Record<string, any>
}

export interface BusinessData {
    lanes: string[] // 泳道名称
    nodes: BusinessNode[] // 业务节点
    edges: { from: string; to: string; label?: string }[] // 业务连线
}

export interface GenerationOptions {
    template: ParsedTemplate
    style?: ParsedStyleTemplate
    businessData: BusinessData
}

/**
 * 从模板中提取布局结构
 */
export function extractLayoutStructure(template: ParsedTemplate) {
    if (template.pools.length === 0) {
        return null
    }

    const pool = template.pools[0]
    const lanes = template.lanes

    // 提取节点模板（不在泳道内的典型节点）
    const nodeTemplates = template.nodes
        .filter((n) => {
            const parentLane = lanes.find((l) => l.id === n.parentId)
            return !parentLane
        })
        .map((n) => ({
            id: n.id,
            style: n.style,
            geometry: n.geometry,
        }))

    return {
        pool,
        lanes,
        nodeTemplates,
        isHorizontal: pool.style.horizontal === 1,
        childLayout: pool.style.childLayout,
    }
}

/**
 * 生成新的图表 XML
 */
export function generateFromTemplate(options: GenerationOptions): string {
    const { template, style, businessData } = options
    const layout = extractLayoutStructure(template)

    if (!layout) {
        // 没有泳道，返回原始模板
        return generateDrawioXml(template)
    }

    // 构建新的节点和边
    const newNodes: NodeInfo[] = []
    const newEdges: EdgeInfo[] = []
    let idCounter = 100

    // 计算每个泳道的节点数量
    const nodesPerLane: Record<string, BusinessNode[]> = {}
    for (const laneName of businessData.lanes) {
        nodesPerLane[laneName] = businessData.nodes.filter(
            (n) => n.laneId === laneName,
        )
    }

    // 泳道高度根据内容调整
    const laneHeight = 150

    // 生成泳道节点
    for (let laneIdx = 0; laneIdx < businessData.lanes.length; laneIdx++) {
        const laneName = businessData.lanes[laneIdx]
        const laneNodes = nodesPerLane[laneName] || []
        const laneId = `lane-${laneIdx}`

        // 节点间距
        const nodeWidth = 70
        const nodeHeight = 37
        const nodeSpacing = 30
        const startX = 60
        const startY = laneIdx * laneHeight + 40

        // 生成每个泳道内的节点
        for (let nodeIdx = 0; nodeIdx < laneNodes.length; nodeIdx++) {
            const businessNode = laneNodes[nodeIdx]
            const nodeId = `node-${idCounter++}`

            const x = startX + nodeIdx * (nodeWidth + nodeSpacing)
            const y = startY

            // 确定节点形状
            let shape = businessNode.shape || "rounded"
            if (businessNode.label === "S" || businessNode.label === "E") {
                shape = "ellipse"
            }

            // 构建节点样式
            let nodeStyle: Record<string, any> = {
                html: 1,
                whiteSpace: "wrap",
                rounded: shape === "rounded" ? 1 : 0,
                shape: shape === "ellipse" ? "ellipse" : undefined,
                strokeWidth: 1,
                fontFamily: "Verdana",
                fontSize: 8,
                align: "center",
            }

            // 应用样式模板
            if (style) {
                nodeStyle = applyStyleToNode(nodeStyle, style)
            }

            newNodes.push({
                id: nodeId,
                parentId: laneId,
                value: businessNode.label,
                geometry: {
                    x,
                    y,
                    width: nodeWidth,
                    height: nodeHeight,
                },
                style: nodeStyle,
            })
        }

        // 生成泳道内连线（同泳道：右边出，左边进）
        for (let i = 0; i < laneNodes.length - 1; i++) {
            const fromNodeId = `node-${idCounter - laneNodes.length + i}`
            const toNodeId = `node-${idCounter - laneNodes.length + i + 1}`

            newEdges.push({
                id: `edge-${idCounter++}`,
                source: fromNodeId,
                target: toNodeId,
                style: {
                    edgeStyle: "orthogonalEdgeStyle",
                    rounded: 0,
                    html: 1,
                    startArrow: "none",
                    endArrow: "classicThin",
                    jettySize: "auto",
                    orthogonalLoop: 1,
                    strokeWidth: 1,
                },
            })
        }
    }

    // 处理跨泳道连线
    // 简化处理：按节点顺序连接
    const allNodes = businessData.nodes
    for (let i = 0; i < allNodes.length - 1; i++) {
        const fromNode = allNodes[i]
        const toNode = allNodes[i + 1]

        // 如果跨泳道
        if (fromNode.laneId !== toNode.laneId) {
            // 查找对应的生成节点
            const fromLaneIdx = businessData.lanes.indexOf(
                fromNode.laneId || "",
            )
            const toLaneIdx = businessData.lanes.indexOf(toNode.laneId || "")

            const fromNodesInLane = nodesPerLane[fromNode.laneId || ""] || []
            const toNodesInLane = nodesPerLane[toNode.laneId || ""] || []

            const fromNodeIdx = fromNodesInLane.indexOf(fromNode)
            const toNodeIdx = toNodesInLane.indexOf(toNode)

            // 跨泳道连线：下边出，上边进
            const sourceNodeId = `node-${100 + fromLaneIdx * 10 + fromNodeIdx}`
            const targetNodeId = `node-${100 + toLaneIdx * 10 + toNodeIdx}`

            newEdges.push({
                id: `edge-cross-${idCounter++}`,
                source: sourceNodeId,
                target: targetNodeId,
                style: {
                    edgeStyle: "orthogonalEdgeStyle",
                    rounded: 0,
                    html: 1,
                    startArrow: "none",
                    endArrow: "classicThin",
                    exitX: 0.5,
                    exitY: 1, // 下边出
                    entryX: 0.5,
                    entryY: 0, // 上边进
                    strokeWidth: 1,
                },
            })
        }
    }

    // 构建最终模板
    const pool = template.pools[0]
    const poolHeight = businessData.lanes.length * laneHeight + 20

    // 使用用户输入的业务需求作为Pool的标题
    const poolTitle = businessData.title || "流程图"

    const resultTemplate: ParsedTemplate = {
        pools: [
            {
                ...pool,
                id: "pool-0",
                value: poolTitle,
                geometry: {
                    ...pool.geometry,
                    height: poolHeight,
                },
                lanes: businessData.lanes.map((name, idx) => ({
                    id: `lane-${idx}`,
                    parentId: "pool-0",
                    value: name,
                    geometry: {
                        y: idx * laneHeight,
                        width: pool.geometry.width || 800,
                        height: laneHeight,
                    },
                    style: {
                        horizontal: pool.style.horizontal,
                        startSize: 20,
                    },
                })),
            },
        ],
        lanes: [],
        nodes: newNodes,
        edges: newEdges,
        rawXml: "",
    }

    return generateDrawioXml(resultTemplate)
}

/**
 * 简化版本：从模板文件生成图表
 */
export function generateFromTemplateFiles(
    diagramXml: string,
    styleMd: string | null,
    businessData: BusinessData,
): string {
    const template = parseDrawioTemplate(diagramXml)
    const style = styleMd ? parseStyleTemplate(styleMd) : undefined

    return generateFromTemplate({ template, style, businessData })
}
