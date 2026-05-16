/**
 * Style Template Parser
 * 解析样式模板 MD 文件，提取设计系统配置
 */

export interface StyleColor {
    hex?: string
    primary: string
    primaryActive: string
    primaryDisabled: string
    ink: string
    body: string
    bodyStrong: string
    muted: string
    mutedSoft: string
    hairline: string
    hairlineSoft: string
    canvas: string
    surfaceSoft: string
    surfaceCard: string
    surfaceCreamStrong: string
    surfaceDark: string
    surfaceDarkElevated: string
    surfaceDarkSoft: string
    onPrimary: string
    onDark: string
    onDarkSoft: string
    accentTeal: string
    accentAmber: string
    success: string
    warning: string
    error: string
}

export interface StyleTypography {
    fontFamily: string
    fontSize: number
    fontWeight: number
    lineHeight: number
    letterSpacing: number
}

export interface StyleRounded {
    xs: number
    sm: number
    md: number
    lg: number
    xl: number
    pill: number
    full: number
}

export interface StyleSpacing {
    xxs: number
    xs: number
    sm: number
    md: number
    lg: number
    xl: number
    xxl: number
    section: number
}

export interface StyleComponent {
    backgroundColor?: string
    textColor?: string
    typography?: string
    rounded?: string
    padding?: string
    height?: string
}

export interface ParsedStyleTemplate {
    version: string
    name: string
    description: string
    colors: StyleColor
    typography: Record<string, StyleTypography>
    rounded: StyleRounded
    spacing: StyleSpacing
    components: Record<string, StyleComponent>
}

/**
 * 简单的 YAML 解析器
 */
function parseYamlSection(yamlContent: string): Record<string, any> {
    const result: Record<string, any> = {}
    const lines = yamlContent.split("\n")

    let _currentKey = ""
    const _currentIndent = 0
    const stack: {
        key: string
        indent: number
        parent: Record<string, any>
    }[] = []

    for (const line of lines) {
        const trimmed = line.trimEnd()
        if (!trimmed) continue

        // 计算缩进级别（2个空格 = 1级）
        const indent = trimmed.length - trimmed.trimStart().length
        const isComment = trimmed.startsWith("#")

        if (isComment) continue

        // 顶级键值对 (无缩进)
        if (indent === 0 && trimmed.includes(":")) {
            const colonIndex = trimmed.indexOf(":")
            const key = trimmed.substring(0, colonIndex).trim()
            const value = trimmed.substring(colonIndex + 1).trim()

            // 弹出栈中深度大于等于当前深度的项
            while (
                stack.length > 0 &&
                stack[stack.length - 1].indent >= indent
            ) {
                stack.pop()
            }

            if (value) {
                // 简单值 - 尝试解析数字
                const cleanValue = value.replace(/^["']|["']$/g, "")
                // 尝试转换为数字
                const numValue = Number(cleanValue)
                result[key] =
                    !isNaN(numValue) && cleanValue !== ""
                        ? numValue
                        : cleanValue
                _currentKey = key
            } else {
                // 对象开始
                result[key] = {}
                _currentKey = key
                stack.push({ key, indent, parent: result })
            }
        }
        // 嵌套键值对
        else if (indent > 0 && trimmed.includes(":")) {
            const colonIndex = trimmed.indexOf(":")
            const key = trimmed.substring(0, colonIndex).trim()
            const value = trimmed.substring(colonIndex + 1).trim()

            // 找到父对象
            let parent: Record<string, any> = result
            for (const item of stack) {
                if (item.indent < indent) {
                    parent = item.parent[item.key] as Record<string, any>
                }
            }

            if (value) {
                let cleanValue = value.replace(/^["']|["']$/g, "")
                // 处理 px 单位
                if (cleanValue.endsWith("px")) {
                    cleanValue = cleanValue.replace("px", "")
                }
                // 尝试转换为数字（保留数字类型）
                const numValue = Number(cleanValue)
                parent[key] =
                    !isNaN(numValue) && cleanValue !== ""
                        ? numValue
                        : cleanValue
            } else {
                parent[key] = {}
            }
        }
    }

    return result
}

/**
 * 解析样式模板文件
 */
export function parseStyleTemplate(mdContent: string): ParsedStyleTemplate {
    if (!mdContent || typeof mdContent !== "string") {
        throw new Error("Invalid input: mdContent must be a non-empty string")
    }

    // 提取 YAML frontmatter（支持 LF 和 CRLF）
    const normalizedContent = mdContent.replace(/\r\n/g, "\n")
    const match = normalizedContent.match(/^---\n([\s\S]*?)\n---/)

    if (!match) {
        throw new Error("Invalid style template: missing YAML frontmatter")
    }

    const yamlContent = match[1]
    const parsed = parseYamlSection(yamlContent)

    // 构建返回结果
    const result: ParsedStyleTemplate = {
        version: parsed.version || "alpha",
        name: parsed.name || "",
        description: parsed.description || "",
        colors: (parsed.colors as StyleColor) || ({} as StyleColor),
        typography: parsed.typography || {},
        rounded: (parsed.rounded as StyleRounded) || ({} as StyleRounded),
        spacing: (parsed.spacing as StyleSpacing) || ({} as StyleSpacing),
        components: parsed.components || {},
    }

    return result
}

/**
 * 将解析的样式转换为 Draw.io XML 样式属性
 */
export function styleToDrawioStyle(
    parsed: ParsedStyleTemplate,
): Record<string, string> {
    const style: Record<string, string> = {}

    // 颜色映射 - 使用 canvas 作为背景色
    if (parsed.colors.canvas) {
        style.fillColor = parsed.colors.canvas
    }

    // 描边颜色 - 使用 ink
    if (parsed.colors.ink) {
        style.strokeColor = parsed.colors.ink
    }

    // 字体颜色
    if (parsed.colors.body) {
        style.fontColor = parsed.colors.body
    } else if (parsed.colors.ink) {
        style.fontColor = parsed.colors.ink
    }

    // 字体 - 使用 body-md 样式
    const bodyTypography = parsed.typography["body-md"]
    if (bodyTypography) {
        style.fontFamily = bodyTypography.fontFamily || "Inter"
        style.fontSize = String(bodyTypography.fontSize || 16)
    }

    // 圆角
    if (parsed.rounded?.md) {
        style.rounded = String(parsed.rounded.md)
    }

    return style
}

/**
 * 应用样式到 Draw.io 节点
 */
export function applyStyleToNode(
    nodeStyle: Record<string, any>,
    styleTemplate: ParsedStyleTemplate,
): Record<string, any> {
    const drawioStyle = styleToDrawioStyle(styleTemplate)

    return {
        ...nodeStyle,
        fillColor: drawioStyle.fillColor || nodeStyle.fillColor,
        strokeColor: drawioStyle.strokeColor || nodeStyle.strokeColor,
        fontColor: drawioStyle.fontColor || nodeStyle.fontColor,
        fontFamily: drawioStyle.fontFamily || nodeStyle.fontFamily,
        fontSize: drawioStyle.fontSize || nodeStyle.fontSize,
        rounded: drawioStyle.rounded || nodeStyle.rounded,
    }
}
