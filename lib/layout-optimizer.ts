/**
 * Layout Optimizer
 * 布局优化算法：防碰撞、泳道自适应、连线调整
 */

import {
    type EdgeInfo,
    generateDrawioXml,
    type LaneInfo,
    type NodeInfo,
    parseDrawioTemplate,
} from "./drawio-parser"

export interface LayoutOptimizerOptions {
    padding?: number
    minLaneWidth?: number
    minLaneHeight?: number
}

/**
 * 检测节点碰撞
 */
function detectCollisions(
    nodes: NodeInfo[],
): { nodeA: string; nodeB: string }[] {
    const collisions: { nodeA: string; nodeB: string }[] = []

    for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
            const a = nodes[i]
            const b = nodes[j]

            if (
                !a.geometry.x ||
                !a.geometry.y ||
                !b.geometry.x ||
                !b.geometry.y
            ) {
                continue
            }

            const aWidth = a.geometry.width || 70
            const aHeight = a.geometry.height || 37
            const bWidth = b.geometry.width || 70
            const bHeight = b.geometry.height || 37

            // 检查重叠
            const overlapX =
                a.geometry.x < b.geometry.x + bWidth &&
                a.geometry.x + aWidth > b.geometry.x
            const overlapY =
                a.geometry.y < b.geometry.y + bHeight &&
                a.geometry.y + aHeight > b.geometry.y

            if (overlapX && overlapY) {
                collisions.push({ nodeA: a.id, nodeB: b.id })
            }
        }
    }

    return collisions
}

/**
 * 解决节点碰撞 - 简单的网格重排
 */
function resolveCollisions(
    nodes: NodeInfo[],
    lanes: LaneInfo[],
    _poolWidth: number,
    options: LayoutOptimizerOptions,
): NodeInfo[] {
    const padding = options.padding || 10
    const nodeWidth = 70
    const _nodeHeight = 37

    // 按泳道分组
    const nodesByLane = new Map<string, NodeInfo[]>()
    for (const node of nodes) {
        const lane = lanes.find((l) => l.id === node.parentId)
        if (!lane) continue

        if (!nodesByLane.has(lane.id)) {
            nodesByLane.set(lane.id, [])
        }
        nodesByLane.get(lane.id)?.push(node)
    }

    // 重排每个泳道内的节点
    const updatedNodes = nodes.map((node) => {
        const lane = lanes.find((l) => l.id === node.parentId)
        if (!lane) return node

        const laneNodes = nodesByLane.get(lane.id) || []
        const nodeIndex = laneNodes.indexOf(node)

        // 横向排列
        const startX = 60
        const x = startX + nodeIndex * (nodeWidth + padding)
        const y = node.geometry.y || 60

        return {
            ...node,
            geometry: {
                ...node.geometry,
                x,
                y,
            },
        }
    })

    return updatedNodes
}

/**
 * 调整泳道宽高自适应
 */
function adjustLaneSize(
    lanes: LaneInfo[],
    nodes: NodeInfo[],
    options: LayoutOptimizerOptions,
): LaneInfo[] {
    const minLaneHeight = options.minLaneHeight || 150

    return lanes.map((lane) => {
        // 找到该泳道内的所有节点
        const laneNodes = nodes.filter((n) => n.parentId === lane.id)

        if (laneNodes.length === 0) {
            return lane
        }

        // 计算最大 Y 坐标 + 节点高度
        let maxY = 0
        for (const node of laneNodes) {
            const nodeBottom =
                (node.geometry.y || 0) + (node.geometry.height || 37)
            if (nodeBottom > maxY) {
                maxY = nodeBottom
            }
        }

        // 添加边距
        const newHeight = Math.max(maxY + 40, minLaneHeight)

        return {
            ...lane,
            geometry: {
                ...lane.geometry,
                height: newHeight,
            },
        }
    })
}

/**
 * 优化连线 - 根据节点位置调整连接点
 */
function optimizeEdgeRouting(
    edges: EdgeInfo[],
    nodes: NodeInfo[],
    lanes: LaneInfo[],
): EdgeInfo[] {
    const nodeMap = new Map(nodes.map((n) => [n.id, n]))
    const _laneMap = new Map(lanes.map((l) => [l.id, l]))

    return edges.map((edge) => {
        const sourceNode = nodeMap.get(edge.source)
        const targetNode = nodeMap.get(edge.target)

        if (!sourceNode || !targetNode) {
            return edge
        }

        // 确定源节点和目标节点是否在同一泳道
        const sourceLane = lanes.find((l) => l.id === sourceNode.parentId)
        const targetLane = lanes.find((l) => l.id === targetNode.parentId)

        const sameLane = sourceLane?.id === targetLane?.id

        // 构建优化后的边样式
        const optimizedStyle = { ...edge.style }

        if (sameLane) {
            // 同泳道：右边出，左边进
            optimizedStyle.exitX = 1
            optimizedStyle.exitY = 0.5
            optimizedStyle.entryX = 0
            optimizedStyle.entryY = 0.5
        } else {
            // 跨泳道：下边出，上边进
            optimizedStyle.exitX = 0.5
            optimizedStyle.exitY = 1
            optimizedStyle.entryX = 0.5
            optimizedStyle.entryY = 0
        }

        return {
            ...edge,
            style: optimizedStyle,
        }
    })
}

/**
 * 主优化函数
 */
export function optimizeLayout(
    xmlContent: string,
    options: LayoutOptimizerOptions = {},
): string {
    if (!xmlContent || typeof xmlContent !== "string") {
        throw new Error("Invalid input: xmlContent must be a non-empty string")
    }

    if (!xmlContent.includes("mxfile")) {
        throw new Error("Invalid Draw.io XML: missing mxfile root element")
    }

    const defaults = {
        padding: 30,
        minLaneWidth: 200,
        minLaneHeight: 150,
    }

    const opts = { ...defaults, ...options }

    // 解析 XML
    const template = parseDrawioTemplate(xmlContent)

    // 1. 检测碰撞
    const collisions = detectCollisions(template.nodes)
    if (collisions.length > 0) {
        console.log(`Found ${collisions.length} collisions, resolving...`)
        template.nodes = resolveCollisions(
            template.nodes,
            template.lanes,
            template.pools[0]?.geometry.width || 800,
            opts,
        )
    }

    // 2. 调整泳道大小
    template.lanes = adjustLaneSize(template.lanes, template.nodes, opts)

    // 3. 优化连线
    template.edges = optimizeEdgeRouting(
        template.edges,
        template.nodes,
        template.lanes,
    )

    // 4. 调整 Pool 大小以适应所有泳道
    if (template.pools.length > 0) {
        let totalLaneHeight = 0
        for (const lane of template.lanes) {
            totalLaneHeight += lane.geometry.height || opts.minLaneHeight
        }
        template.pools[0].geometry.height = totalLaneHeight + 40
    }

    // 生成优化后的 XML
    return generateDrawioXml(template)
}

/**
 * 快速检查是否需要优化
 */
export function needsOptimization(xmlContent: string): boolean {
    if (!xmlContent || typeof xmlContent !== "string") {
        return false
    }

    if (!xmlContent.includes("mxfile")) {
        return false
    }

    try {
        const template = parseDrawioTemplate(xmlContent)

        // 检查是否有碰撞
        const collisions = detectCollisions(template.nodes)
        if (collisions.length > 0) {
            return true
        }

        // 检查泳道是否太小
        for (const lane of template.lanes) {
            const laneNodes = template.nodes.filter(
                (n) => n.parentId === lane.id,
            )
            if (laneNodes.length > 0) {
                const maxY = Math.max(
                    ...laneNodes.map(
                        (n) => (n.geometry.y || 0) + (n.geometry.height || 0),
                    ),
                )
                if (maxY > (lane.geometry.height || 0) - 20) {
                    return true
                }
            }
        }

        return false
    } catch {
        return false
    }
}
