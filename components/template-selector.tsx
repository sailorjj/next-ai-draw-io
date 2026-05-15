"use client"

import { Check, Download, FileText, Library, Upload, X } from "lucide-react"
import { cn } from "@/lib/utils"

export interface TemplateFile {
    id: string
    name: string
    type: "diagram" | "style"
    content: string
    file?: File
}

interface TemplateSelectorProps {
    diagramTemplate?: TemplateFile
    styleTemplate?: TemplateFile
    onDiagramSelect: (template: TemplateFile | undefined) => void
    onStyleSelect: (template: TemplateFile | undefined) => void
    useShapeLibrary?: boolean
    onUseShapeLibraryChange?: (value: boolean) => void
    className?: string
}

const BUILTIN_DIAGRAMS = [
    {
        id: "horizontal",
        name: "横向泳道",
        path: "/template/横向泳道流程模板.drawio",
    },
    {
        id: "vertical",
        name: "竖向泳道",
        path: "/template/竖向泳道流程模板.drawio",
    },
    {
        id: "matrix",
        name: "矩阵泳道",
        path: "/template/矩阵泳道流程模板.drawio",
    },
    { id: "mindmap", name: "思维导图", path: "/template/思维导图.drawio" },
]

const BUILTIN_STYLES = [
    { id: "claude", name: "Claude样式", path: "/template/DESIGN-claude.md" },
]

export function TemplateSelector({
    diagramTemplate,
    styleTemplate,
    onDiagramSelect,
    onStyleSelect,
    useShapeLibrary = true,
    onUseShapeLibraryChange,
    className,
}: TemplateSelectorProps) {
    const handleLoadBuiltin = async (
        path: string,
        id: string,
        type: "diagram" | "style",
    ) => {
        try {
            const response = await fetch(path)
            const content = await response.text()
            const template: TemplateFile = {
                id,
                name: path.split("/").pop() || id,
                type,
                content,
            }
            if (type === "diagram") {
                onDiagramSelect(template)
            } else {
                onStyleSelect(template)
            }
        } catch (error) {
            console.error("Failed to load template:", error)
        }
    }

    const handleFileSelect = (
        e: React.ChangeEvent<HTMLInputElement>,
        type: "diagram" | "style",
    ) => {
        const file = e.target.files?.[0]
        if (!file) return

        const reader = new FileReader()
        reader.onload = (event) => {
            const content = event.target?.result as string
            const template: TemplateFile = {
                id: `${Date.now()}`,
                name: file.name,
                type,
                content,
                file,
            }
            if (type === "diagram") {
                onDiagramSelect(template)
            } else {
                onStyleSelect(template)
            }
        }
        reader.readAsText(file)
    }

    return (
        <div className={cn("space-y-2", className)}>
            <div className="text-xs font-medium text-muted-foreground">
                选模板建图表
            </div>

            <div className="flex flex-wrap items-center gap-2">
                {/* 图表模板选择 */}
                <div className="flex items-center gap-1">
                    {diagramTemplate ? (
                        <button
                            type="button"
                            onClick={() => onDiagramSelect(undefined)}
                            className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                            title="点击取消选择"
                        >
                            <Check className="w-3 h-3" />
                            {diagramTemplate.name}
                            <X className="w-3 h-3" />
                        </button>
                    ) : (
                        <>
                            {BUILTIN_DIAGRAMS.map((tmpl) => (
                                <button
                                    key={tmpl.id}
                                    type="button"
                                    onClick={() =>
                                        handleLoadBuiltin(
                                            tmpl.path,
                                            tmpl.id,
                                            "diagram",
                                        )
                                    }
                                    className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-muted hover:bg-muted/80 text-muted-foreground transition-colors"
                                >
                                    <Download className="w-3 h-3" />
                                    {tmpl.name}
                                </button>
                            ))}
                            <label className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-muted hover:bg-muted/80 text-muted-foreground cursor-pointer transition-colors">
                                <Upload className="w-3 h-3" />
                                上传
                                <input
                                    type="file"
                                    accept=".drawio"
                                    className="hidden"
                                    onChange={(e) =>
                                        handleFileSelect(e, "diagram")
                                    }
                                />
                            </label>
                        </>
                    )}
                </div>

                {/* 样式模板选择 */}
                <div className="flex items-center gap-1">
                    {styleTemplate ? (
                        <button
                            type="button"
                            onClick={() => onStyleSelect(undefined)}
                            className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                            title="点击取消选择"
                        >
                            <Check className="w-3 h-3" />
                            {styleTemplate.name}
                            <X className="w-3 h-3" />
                        </button>
                    ) : (
                        <>
                            {BUILTIN_STYLES.map((tmpl) => (
                                <button
                                    key={tmpl.id}
                                    type="button"
                                    onClick={() =>
                                        handleLoadBuiltin(
                                            tmpl.path,
                                            tmpl.id,
                                            "style",
                                        )
                                    }
                                    className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-muted hover:bg-muted/80 text-muted-foreground transition-colors"
                                >
                                    <FileText className="w-3 h-3" />
                                    {tmpl.name}
                                </button>
                            ))}
                            <label className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-muted hover:bg-muted/80 text-muted-foreground cursor-pointer transition-colors">
                                <Upload className="w-3 h-3" />
                                上传
                                <input
                                    type="file"
                                    accept=".md"
                                    className="hidden"
                                    onChange={(e) =>
                                        handleFileSelect(e, "style")
                                    }
                                />
                            </label>
                        </>
                    )}
                </div>

                {/* Shape Library 开关 */}
                {onUseShapeLibraryChange && (
                    <button
                        type="button"
                        onClick={() =>
                            onUseShapeLibraryChange(!useShapeLibrary)
                        }
                        className={cn(
                            "flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors",
                            useShapeLibrary
                                ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400"
                                : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
                        )}
                        title={
                            useShapeLibrary
                                ? "当前：使用Shape Library"
                                : "当前：使用模板shape"
                        }
                    >
                        <Library className="w-3 h-3" />
                        {useShapeLibrary ? "使用Shape库" : "用模板shape"}
                    </button>
                )}
            </div>
        </div>
    )
}
