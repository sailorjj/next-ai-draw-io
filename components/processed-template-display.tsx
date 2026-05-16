"use client"

import { ChevronDown, ChevronUp, Layout } from "lucide-react"
import { useState } from "react"
import { cn } from "@/lib/utils"

export interface ProcessedTemplateDisplayProps {
    diagramTemplateName: string
    layout?: {
        poolStyle?: string
        laneStyles?: string[]
        idParentMap?: { id: string; parent: string; value: string }[]
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
                "my-3 rounded-xl border border-border/60 bg-muted/30 overflow-hidden",
                className,
            )}
        >
            {/* 头部 - 可点击展开/折叠 */}
            <button
                type="button"
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-muted/50 transition-colors"
            >
                <div className="flex items-center gap-2">
                    <Layout className="w-4 h-4 text-blue-500" />
                    <span className="text-sm font-medium text-foreground/80">
                        预处理Diagram
                    </span>
                    <span className="text-xs text-muted-foreground">
                        {diagramTemplateName} · {laneCount}个泳道
                    </span>
                </div>
                {isExpanded ? (
                    <ChevronUp className="w-4 h-4 text-muted-foreground" />
                ) : (
                    <ChevronDown className="w-4 h-4 text-muted-foreground" />
                )}
            </button>

            {/* 详细内容 - 展开后显示 */}
            {isExpanded && (
                <div className="px-4 py-3 border-t border-border/40">
                    <pre className="text-xs bg-muted p-2 rounded overflow-x-auto max-h-64 whitespace-pre-wrap">
                        <code className="text-foreground/80">
                            {xmlStructure}
                        </code>
                    </pre>
                </div>
            )}
        </div>
    )
}
