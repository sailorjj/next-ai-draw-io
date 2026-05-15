"use client"

import { Check, Download, FileText, FileUp, X } from "lucide-react"
import { useCallback, useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

export interface TemplateFile {
    id: string
    name: string
    type: "diagram" | "style"
    content: string
    file?: File
}

interface TemplateUploaderProps {
    onTemplatesChange: (templates: TemplateFile[]) => void
    templates?: TemplateFile[]
    showBusinessInput?: boolean
    businessInput?: string
    onBusinessInputChange?: (value: string) => void
}

// 内置模板列表
const BUILTIN_TEMPLATES = [
    {
        id: "horizontal",
        name: "横向泳道流程",
        type: "diagram" as const,
        path: "/template/横向泳道流程模板.drawio",
    },
    {
        id: "vertical",
        name: "竖向泳道流程",
        type: "diagram" as const,
        path: "/template/竖向泳道流程模板.drawio",
    },
    {
        id: "matrix",
        name: "矩阵泳道流程",
        type: "diagram" as const,
        path: "/template/矩阵泳道流程模板.drawio",
    },
    {
        id: "mindmap",
        name: "思维导图",
        type: "diagram" as const,
        path: "/template/思维导图.drawio",
    },
]

const _BUILTIN_STYLES = [
    {
        id: "claude",
        name: "Claude 样式",
        type: "style" as const,
        path: "/template/DESIGN-claude.md",
    },
]

export function TemplateUploader({
    onTemplatesChange,
    templates = [],
    showBusinessInput = true,
    businessInput = "",
    onBusinessInputChange,
}: TemplateUploaderProps) {
    const [localTemplates, setLocalTemplates] = useState<TemplateFile[]>([])
    const [isDragging, setIsDragging] = useState(false)
    const [loadingTemplates, setLoadingTemplates] = useState<Set<string>>(
        new Set(),
    )
    const diagramInputRef = useRef<HTMLInputElement>(null)
    const styleInputRef = useRef<HTMLInputElement>(null)

    // 同步外部传入的 templates
    useEffect(() => {
        setLocalTemplates(templates)
    }, [templates])

    // 当本地模板变化时，通知父组件
    useEffect(() => {
        if (localTemplates.length > 0) {
            onTemplatesChange(localTemplates)
        }
    }, [localTemplates, onTemplatesChange])

    // 加载内置模板
    const loadBuiltinTemplate = useCallback(
        async (path: string, id: string, type: "diagram" | "style") => {
            if (loadingTemplates.has(id)) return

            setLoadingTemplates((prev) => new Set(prev).add(id))

            try {
                const response = await fetch(path)
                const content = await response.text()

                const newTemplate: TemplateFile = {
                    id,
                    name: path.split("/").pop() || id,
                    type,
                    content,
                }

                setLocalTemplates((prev) => {
                    const filtered = prev.filter((t) => t.type !== type)
                    return [...filtered, newTemplate]
                })
            } catch (error) {
                console.error("Failed to load template:", error)
            } finally {
                setLoadingTemplates((prev) => {
                    const next = new Set(prev)
                    next.delete(id)
                    return next
                })
            }
        },
        [loadingTemplates],
    )

    const handleFiles = useCallback(
        (files: FileList | null, type: "diagram" | "style") => {
            if (!files) return

            Array.from(files).forEach((file) => {
                const reader = new FileReader()
                reader.onload = (e) => {
                    const content = e.target?.result as string

                    const newTemplate: TemplateFile = {
                        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        name: file.name,
                        type,
                        content,
                        file,
                    }

                    setLocalTemplates((prev) => {
                        const filtered = prev.filter((t) => t.type !== type)
                        return [...filtered, newTemplate]
                    })
                }
                reader.readAsText(file)
            })
        },
        [],
    )

    const removeTemplate = useCallback((id: string) => {
        setLocalTemplates((prev) => {
            return prev.filter((t) => t.id !== id)
        })
    }, [])

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(true)
    }

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(false)
    }

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault()
        setIsDragging(false)

        const files = e.dataTransfer.files
        Array.from(files).forEach((file) => {
            if (file.name.endsWith(".drawio")) {
                const dt = new DataTransfer()
                dt.items.add(file)
                handleFiles(dt.files, "diagram")
            } else if (file.name.endsWith(".md")) {
                const dt = new DataTransfer()
                dt.items.add(file)
                handleFiles(dt.files, "style")
            }
        })
    }

    const diagramTemplate = localTemplates.find((t) => t.type === "diagram")
    const styleTemplate = localTemplates.find((t) => t.type === "style")

    return (
        <div className="space-y-3">
            {/* 内置模板选择 */}
            <div>
                <div className="text-xs text-muted-foreground mb-2">
                    选择图表模板
                </div>
                <div className="flex flex-wrap gap-1.5">
                    {BUILTIN_TEMPLATES.map((tmpl) => (
                        <button
                            key={tmpl.id}
                            type="button"
                            onClick={() =>
                                loadBuiltinTemplate(
                                    tmpl.path,
                                    tmpl.id,
                                    tmpl.type,
                                )
                            }
                            disabled={loadingTemplates.has(tmpl.id)}
                            className={cn(
                                "flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors",
                                diagramTemplate?.id === tmpl.id
                                    ? "bg-primary text-primary-foreground"
                                    : "bg-muted hover:bg-muted/80 text-muted-foreground",
                                loadingTemplates.has(tmpl.id) && "opacity-50",
                            )}
                        >
                            {loadingTemplates.has(tmpl.id) ? (
                                <span className="animate-spin">...</span>
                            ) : diagramTemplate?.id === tmpl.id ? (
                                <Check className="w-3 h-3" />
                            ) : (
                                <Download className="w-3 h-3" />
                            )}
                            {tmpl.name}
                        </button>
                    ))}
                </div>
            </div>

            {/* 自定义文件上传 */}
            <div>
                <div className="text-xs text-muted-foreground mb-1">
                    或上传自定义模板
                </div>
                <div
                    className={cn(
                        "border-2 border-dashed rounded-lg p-2 transition-colors",
                        isDragging
                            ? "border-primary bg-primary/5"
                            : "border-border/50 hover:border-primary/50",
                    )}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                >
                    <div className="flex items-center gap-2">
                        {/* 图表模板上传 */}
                        <button
                            type="button"
                            onClick={() => diagramInputRef.current?.click()}
                            className={cn(
                                "flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors",
                                diagramTemplate
                                    ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                    : "bg-muted hover:bg-muted/80 text-muted-foreground",
                            )}
                        >
                            {diagramTemplate ? (
                                <>
                                    <Check className="w-3 h-3" />
                                    {diagramTemplate.name}
                                </>
                            ) : (
                                <>
                                    <FileUp className="w-3 h-3" />
                                    图表
                                </>
                            )}
                        </button>
                        <input
                            ref={diagramInputRef}
                            type="file"
                            accept=".drawio"
                            onChange={(e) =>
                                handleFiles(e.target.files, "diagram")
                            }
                            className="hidden"
                        />

                        {/* 样式模板上传 */}
                        <button
                            type="button"
                            onClick={() => styleInputRef.current?.click()}
                            className={cn(
                                "flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors",
                                styleTemplate
                                    ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                    : "bg-muted hover:bg-muted/80 text-muted-foreground",
                            )}
                        >
                            {styleTemplate ? (
                                <>
                                    <Check className="w-3 h-3" />
                                    {styleTemplate.name}
                                </>
                            ) : (
                                <>
                                    <FileText className="w-3 h-3" />
                                    样式
                                </>
                            )}
                        </button>
                        <input
                            ref={styleInputRef}
                            type="file"
                            accept=".md"
                            onChange={(e) =>
                                handleFiles(e.target.files, "style")
                            }
                            className="hidden"
                        />

                        {localTemplates.length > 0 && (
                            <button
                                type="button"
                                onClick={() => {
                                    localTemplates.forEach((t) => {
                                        removeTemplate(t.id)
                                    })
                                }}
                                className="p-1 rounded hover:bg-muted text-muted-foreground ml-auto"
                                title="清除所有模板"
                            >
                                <X className="w-3 h-3" />
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* 业务需求输入 */}
            {showBusinessInput && (
                <div>
                    <div className="text-xs text-muted-foreground mb-1">
                        业务需求（可选）
                    </div>
                    <textarea
                        value={businessInput}
                        onChange={(e) =>
                            onBusinessInputChange?.(e.target.value)
                        }
                        placeholder="描述您想要生成的流程图需求，例如：用户登录流程，包含用户名密码验证、验证码校验等步骤..."
                        className="w-full min-h-[60px] px-2 py-1.5 text-sm rounded border border-border/50 bg-background focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                    />
                </div>
            )}

            {/* 模板状态 */}
            {localTemplates.length > 0 && (
                <div className="text-xs text-muted-foreground">
                    已加载 {localTemplates.length} 个模板
                </div>
            )}
        </div>
    )
}
