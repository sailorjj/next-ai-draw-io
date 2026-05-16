"use client"

import { ChevronDown, ChevronRight, Layout } from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"

export interface ProcessedTemplateDisplayProps {
    diagramTemplateName: string
    layout?: {
        poolStyle?: string // Pool的完整style属性字符串
        laneStyles?: string[] // Lane的完整style属性数组
        idParentMap?: { id: string; parent: string; value: string }[] // ID-parent关系
        poolId?: string
        laneIds?: string[]
    }
    nodes?: { id: string; value: string; parentId: string; shape?: string }[]
    edges?: {
        id: string
        source: string
        target: string
        value?: string
        style: string
    }[]
    styleVariables?: { name: string; value: string }[]
    xmlStructure: string
    summary?: string
    className?: string
}

export function ProcessedTemplateDisplay({
    diagramTemplateName,
    layout = {},
    nodes = [],
    edges = [],
    styleVariables = [],
    xmlStructure,
    summary = "",
    className,
}: ProcessedTemplateDisplayProps) {
    const [isExpanded, setIsExpanded] = useState(false)

    const laneCount = layout.laneIds?.length || layout.laneStyles?.length || 0

    return (
        <div
            className={cn(
                "border rounded-lg bg-card/50 overflow-hidden",
                className,
            )}
        >
            {/* 头部 - 可点击展开/折叠 */}
            <button
                type="button"
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-card/80 transition-colors"
            >
                {isExpanded ? (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                ) : (
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                )}
                <Layout className="w-4 h-4 text-blue-500" />
                <span className="text-sm font-medium">模板预处理结果</span>
                <span className="text-xs text-muted-foreground">
                    {diagramTemplateName} · {laneCount}个泳道
                </span>
            </button>

            {/* 精简内容 - 默认显示 */}
            {!isExpanded && (
                <div className="px-3 pb-2 text-xs text-muted-foreground">
                    {summary}
                </div>
            )}

            {/* 详细内容 - 展开后显示 */}
            {isExpanded && (
                <div className="px-3 pb-3 space-y-3 border-t">
                    {/* 摘要 */}
                    <div className="pt-2">
                        <div className="text-xs font-medium text-muted-foreground mb-1">
                            布局摘要
                        </div>
                        <div className="text-sm">{summary}</div>
                    </div>

                    {/* Pool ID */}
                    <div>
                        <div className="text-xs font-medium text-muted-foreground mb-1">
                            Pool ID
                        </div>
                        <div className="text-sm font-mono bg-muted px-2 py-1 rounded inline-block">
                            {layout.poolId}
                        </div>
                    </div>

                    {/* Pool Style */}
                    <div>
                        <div className="text-xs font-medium text-muted-foreground mb-1">
                            Pool Style
                        </div>
                        <div className="text-xs font-mono bg-muted p-2 rounded break-all whitespace-pre-wrap">
                            {layout.poolStyle}
                        </div>
                    </div>

                    {/* Lane Styles */}
                    <div>
                        <div className="text-xs font-medium text-muted-foreground mb-1">
                            Lane Styles ({laneCount})
                        </div>
                        <div className="space-y-1">
                            {(layout.laneStyles || []).map((style, idx) => (
                                <div
                                    key={idx}
                                    className="text-xs font-mono bg-muted px-2 py-1 rounded break-all whitespace-pre-wrap"
                                >
                                    {style}
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* ID-Parent关系 */}
                    {layout.idParentMap && layout.idParentMap.length > 0 && (
                        <div>
                            <div className="text-xs font-medium text-muted-foreground mb-1">
                                ID-Parent结构
                            </div>
                            <div className="space-y-0.5">
                                {layout.idParentMap.map((m, idx) => (
                                    <div key={idx} className="text-xs">
                                        <span className="font-mono text-blue-600">
                                            {m.id}
                                        </span>
                                        <span className="mx-1">→</span>
                                        <span className="font-mono text-green-600">
                                            {m.parent || "(root)"}
                                        </span>
                                        {m.value && (
                                            <span className="ml-2 text-muted-foreground">
                                                ({m.value})
                                            </span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* 节点列表 */}
                    {nodes.length > 0 && (
                        <div>
                            <div className="text-xs font-medium text-muted-foreground mb-1">
                                节点列表 ({nodes.length})
                            </div>
                            <div className="space-y-0.5 max-h-32 overflow-y-auto">
                                {nodes.slice(0, 20).map((node, idx) => (
                                    <div key={idx} className="text-xs">
                                        <span className="font-mono text-blue-600">
                                            {node.id}
                                        </span>
                                        <span className="mx-1">:</span>
                                        <span className="text-muted-foreground">
                                            "{node.value}"
                                        </span>
                                        <span className="text-orange-600">
                                            {" "}
                                            →{node.parentId}
                                        </span>
                                        {node.shape && (
                                            <span className="ml-1 text-purple-600">
                                                ({node.shape})
                                            </span>
                                        )}
                                    </div>
                                ))}
                                {nodes.length > 20 && (
                                    <div className="text-xs text-muted-foreground">
                                        ... 还有 {nodes.length - 20} 个节点
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* 连线/判断分支 */}
                    {edges.length > 0 && (
                        <div>
                            <div className="text-xs font-medium text-muted-foreground mb-1">
                                连线/判断分支 ({edges.length})
                            </div>
                            <div className="space-y-0.5 max-h-32 overflow-y-auto">
                                {edges.slice(0, 20).map((edge, idx) => (
                                    <div key={idx} className="text-xs">
                                        <span className="font-mono text-blue-600">
                                            {edge.id}
                                        </span>
                                        <span className="mx-1">:</span>
                                        <span className="font-mono text-green-600">
                                            {edge.source}
                                        </span>
                                        <span className="mx-1">→</span>
                                        <span className="font-mono text-green-600">
                                            {edge.target}
                                        </span>
                                        {edge.value && (
                                            <span className="ml-1 text-amber-600">
                                                [{edge.value}]
                                            </span>
                                        )}
                                    </div>
                                ))}
                                {edges.length > 20 && (
                                    <div className="text-xs text-muted-foreground">
                                        ... 还有 {edges.length - 20} 条连线
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* 样式变量 */}
                    {styleVariables && styleVariables.length > 0 && (
                        <div>
                            <div className="text-xs font-medium text-muted-foreground mb-1">
                                样式变量 (已替换)
                            </div>
                            <div className="flex flex-wrap gap-2">
                                {styleVariables.map((s, idx) => (
                                    <span
                                        key={idx}
                                        className="px-2 py-0.5 text-xs font-mono bg-purple-50 text-purple-700 dark:bg-purple-900/20 dark:text-purple-400 rounded"
                                    >
                                        {s.name}={s.value}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* XML结构 */}
                    <div>
                        <div className="text-xs font-medium text-muted-foreground mb-1">
                            完整XML结构
                        </div>
                        <pre className="text-xs bg-muted p-2 rounded overflow-x-auto max-h-64">
                            <code className="text-muted-foreground">
                                {xmlStructure}
                            </code>
                        </pre>
                    </div>
                </div>
            )}
        </div>
    )
}
