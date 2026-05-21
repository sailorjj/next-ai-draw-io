import { type ClassValue, clsx } from "clsx"
import * as pako from "pako"
import { twMerge } from "tailwind-merge"
import type { DiagramOperation } from "@/components/chat/types"

export type { DiagramOperation }

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs))
}

// ============================================================================
// Diagram Constants
// ============================================================================

/**
 * Minimum length for a "real" diagram XML (not just empty template).
 * Empty mxfile templates are ~147-300 chars; real diagrams are larger.
 */
export const MIN_REAL_DIAGRAM_LENGTH = 300

/**
 * Check if diagram XML represents a real diagram (not just empty template).
 * @param xml - The diagram XML string to check
 * @returns true if the XML is a real diagram with content
 */
export function isRealDiagram(xml: string | undefined | null): boolean {
    return !!xml && xml.length > MIN_REAL_DIAGRAM_LENGTH
}

// ============================================================================
// XML Validation/Fix Constants
// ============================================================================

/** Maximum XML size to process (1MB) - larger XMLs may cause performance issues */
const MAX_XML_SIZE = 1_000_000

/** Maximum iterations for aggressive cell dropping to prevent infinite loops */
const MAX_DROP_ITERATIONS = 10

/** Structural attributes that should not be duplicated in draw.io */
const STRUCTURAL_ATTRS = [
    "edge",
    "parent",
    "source",
    "target",
    "vertex",
    "connectable",
]

/** Valid XML entity names */
const VALID_ENTITIES = new Set(["lt", "gt", "amp", "quot", "apos"])

// ============================================================================
// mxCell XML Helpers
// ============================================================================

/**
 * Check if mxCell XML output is complete (not truncated).
 * Complete XML ends with a self-closing tag (/>) or closing mxCell tag.
 * Uses a robust approach that handles any LLM provider's wrapper tags
 * by finding the last valid mxCell ending and checking if suffix is just closing tags.
 * @param xml - The XML string to check (can be undefined/null)
 * @returns true if XML appears complete, false if truncated or empty
 */
export function isMxCellXmlComplete(xml: string | undefined | null): boolean {
    const trimmed = xml?.trim() || ""
    if (!trimmed) return false

    // Find position of last complete mxCell ending (either /> or </mxCell>)
    const lastSelfClose = trimmed.lastIndexOf("/>")
    const lastMxCellClose = trimmed.lastIndexOf("</mxCell>")

    const lastValidEnd = Math.max(lastSelfClose, lastMxCellClose)

    // No valid ending found at all
    if (lastValidEnd === -1) return false

    // Check what comes after the last valid ending
    // For />: add 2 chars, for </mxCell>: add 9 chars
    const endOffset = lastMxCellClose > lastSelfClose ? 9 : 2
    const suffix = trimmed.slice(lastValidEnd + endOffset)

    // If suffix is empty or only contains closing tags (any provider's wrapper) or whitespace, it's complete
    // This regex matches any sequence of closing XML tags like </foo>, </bar>, </｜DSML｜xyz>
    return /^(\s*<\/[^>]+>)*\s*$/.test(suffix)
}

/**
 * Extract only complete mxCell elements from partial/streaming XML.
 * This allows progressive rendering during streaming by ignoring incomplete trailing elements.
 * @param xml - The partial XML string (may contain incomplete trailing mxCell)
 * @returns XML string containing only complete mxCell elements
 */
export function extractCompleteMxCells(xml: string | undefined | null): string {
    if (!xml) return ""

    const completeCells: Array<{ index: number; text: string }> = []

    // Match self-closing mxCell tags: <mxCell ... />
    // Also match mxCell with nested mxGeometry: <mxCell ...>...<mxGeometry .../></mxCell>
    const selfClosingPattern = /<mxCell\s+[^>]*\/>/g
    const nestedPattern = /<mxCell\s+[^>]*>[\s\S]*?<\/mxCell>/g

    // Find all self-closing mxCell elements
    let match: RegExpExecArray | null
    while ((match = selfClosingPattern.exec(xml)) !== null) {
        completeCells.push({ index: match.index, text: match[0] })
    }

    // Find all mxCell elements with nested content (like mxGeometry)
    while ((match = nestedPattern.exec(xml)) !== null) {
        completeCells.push({ index: match.index, text: match[0] })
    }

    // Sort by position to maintain order
    completeCells.sort((a, b) => a.index - b.index)

    // Remove duplicates (a self-closing match might overlap with nested match)
    const seen = new Set<number>()
    const uniqueCells = completeCells.filter((cell) => {
        if (seen.has(cell.index)) return false
        seen.add(cell.index)
        return true
    })

    return uniqueCells.map((c) => c.text).join("\n")
}

// ============================================================================
// XML Parsing Helpers
// ============================================================================

interface ParsedTag {
    tag: string
    tagName: string
    isClosing: boolean
    isSelfClosing: boolean
    startIndex: number
    endIndex: number
}

/**
 * Parse XML tags while properly handling quoted strings
 * This is a shared utility used by both validation and fixing logic
 */
function parseXmlTags(xml: string): ParsedTag[] {
    const tags: ParsedTag[] = []
    let i = 0

    while (i < xml.length) {
        const tagStart = xml.indexOf("<", i)
        if (tagStart === -1) break

        // Find matching > by tracking quotes
        let tagEnd = tagStart + 1
        let inQuote = false
        let quoteChar = ""

        while (tagEnd < xml.length) {
            const c = xml[tagEnd]
            if (inQuote) {
                if (c === quoteChar) inQuote = false
            } else {
                if (c === '"' || c === "'") {
                    inQuote = true
                    quoteChar = c
                } else if (c === ">") {
                    break
                }
            }
            tagEnd++
        }

        if (tagEnd >= xml.length) break

        const tag = xml.substring(tagStart, tagEnd + 1)
        i = tagEnd + 1

        const tagMatch = /^<(\/?)([a-zA-Z][a-zA-Z0-9:_-]*)/.exec(tag)
        if (!tagMatch) continue

        tags.push({
            tag,
            tagName: tagMatch[2],
            isClosing: tagMatch[1] === "/",
            isSelfClosing: tag.endsWith("/>"),
            startIndex: tagStart,
            endIndex: tagEnd,
        })
    }

    return tags
}

/**
 * Format XML string with proper indentation and line breaks
 * @param xml - The XML string to format
 * @param indent - The indentation string (default: '  ')
 * @returns Formatted XML string
 */
export function formatXML(xml: string, indent: string = "  "): string {
    let formatted = ""
    let pad = 0

    // Remove existing whitespace between tags
    xml = xml.replace(/>\s*</g, "><").trim()

    // Split on tags
    const tags = xml.split(/(?=<)|(?<=>)/g).filter(Boolean)

    tags.forEach((node) => {
        if (node.match(/^<\/\w/)) {
            // Closing tag - decrease indent
            pad = Math.max(0, pad - 1)
            formatted += indent.repeat(pad) + node + "\n"
        } else if (node.match(/^<\w[^>]*[^/]>.*$/)) {
            // Opening tag
            formatted += indent.repeat(pad) + node
            // Only add newline if next item is a tag
            const nextIndex = tags.indexOf(node) + 1
            if (nextIndex < tags.length && tags[nextIndex].startsWith("<")) {
                formatted += "\n"
                if (!node.match(/^<\w[^>]*\/>$/)) {
                    pad++
                }
            }
        } else if (node.match(/^<\w[^>]*\/>$/)) {
            // Self-closing tag
            formatted += indent.repeat(pad) + node + "\n"
        } else if (node.startsWith("<")) {
            // Other tags (like <?xml)
            formatted += indent.repeat(pad) + node + "\n"
        } else {
            // Text content
            formatted += node
        }
    })

    return formatted.trim()
}

/**
 * Efficiently converts a potentially incomplete XML string to a legal XML string by closing any open tags properly.
 * Additionally, if an <mxCell> tag does not have an mxGeometry child (e.g. <mxCell id="3">),
 * it removes that tag from the output.
 * Also removes orphaned <mxPoint> elements that aren't inside <Array> or don't have proper 'as' attribute.
 * @param xmlString The potentially incomplete XML string
 * @returns A legal XML string with properly closed tags and removed incomplete mxCell elements.
 */
export function convertToLegalXml(xmlString: string): string {
    // This regex will match either self-closing <mxCell .../> or a block element
    // <mxCell ...> ... </mxCell>. Unfinished ones are left out because they don't match.
    const regex = /<mxCell\b[^>]*(?:\/>|>([\s\S]*?)<\/mxCell>)/g
    let match: RegExpExecArray | null
    let result = "<root>\n"

    while ((match = regex.exec(xmlString)) !== null) {
        // match[0] contains the entire matched mxCell block
        let cellContent = match[0]

        // Remove orphaned <mxPoint> elements that are directly inside <mxGeometry>
        // without an 'as' attribute (like as="sourcePoint", as="targetPoint")
        // and not inside <Array as="points">
        // These cause "Could not add object mxPoint" errors in draw.io
        // First check if there's an <Array as="points"> - if so, keep all mxPoints inside it
        const hasArrayPoints = /<Array\s+as="points">/.test(cellContent)
        if (!hasArrayPoints) {
            // Remove mxPoint elements without 'as' attribute
            cellContent = cellContent.replace(
                /<mxPoint\b[^>]*\/>/g,
                (pointMatch) => {
                    // Keep if it has an 'as' attribute
                    if (/\sas=/.test(pointMatch)) {
                        return pointMatch
                    }
                    // Remove orphaned mxPoint
                    return ""
                },
            )
        }

        // Fix unescaped & characters in attribute values (but not valid entities)
        // This prevents DOMParser from failing on content like "semantic & missing-step"
        cellContent = cellContent.replace(
            /&(?!(?:lt|gt|amp|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);)/g,
            "&amp;",
        )

        // Fix unescaped < and > in attribute values for XML parsing
        // HTML content in value attributes (e.g., <b>Title</b>) needs to be escaped
        // This is critical because DOMParser will fail on unescaped < > in attributes
        if (/=\s*"[^"]*<[^"]*"/.test(cellContent)) {
            cellContent = cellContent.replace(
                /=\s*"([^"]*)"/g,
                (_match, value) => {
                    const escaped = value
                        .replace(/</g, "&lt;")
                        .replace(/>/g, "&gt;")
                    return `="${escaped}"`
                },
            )
        }

        // Indent each line of the matched block for readability.
        const formatted = cellContent
            .split("\n")
            .map((line) => "    " + line.trim())
            .filter((line) => line.trim()) // Remove empty lines from removed mxPoints
            .join("\n")
        result += formatted + "\n"
    }
    result += "</root>"

    return result
}

/**
 * Wrap XML content with the full mxfile structure required by draw.io.
 * Always adds root cells (id="0" and id="1") automatically.
 * If input already contains root cells, they are removed to avoid duplication.
 * LLM should only generate mxCell elements starting from id="2".
 * @param xml - The XML string (bare mxCells, <root>, <mxGraphModel>, or full <mxfile>)
 * @returns Full mxfile-wrapped XML string with root cells included
 */
export function wrapWithMxFile(xml: string): string {
    const ROOT_CELLS = '<mxCell id="0"/><mxCell id="1" parent="0"/>'

    if (!xml || !xml.trim()) {
        return `<mxfile><diagram name="Page-1" id="page-1"><mxGraphModel><root>${ROOT_CELLS}</root></mxGraphModel></diagram></mxfile>`
    }

    // Already has full structure
    if (xml.includes("<mxfile")) {
        return xml
    }

    // Has mxGraphModel but not mxfile
    if (xml.includes("<mxGraphModel")) {
        return `<mxfile><diagram name="Page-1" id="page-1">${xml}</diagram></mxfile>`
    }

    // Has <root> wrapper - extract inner content
    let content = xml
    if (xml.includes("<root>")) {
        content = xml.replace(/<\/?root>/g, "").trim()
    }

    // Strip trailing LLM wrapper tags (from any provider: Anthropic, DeepSeek, etc.)
    // Find the last valid mxCell ending and remove everything after it
    const lastSelfClose = content.lastIndexOf("/>")
    const lastMxCellClose = content.lastIndexOf("</mxCell>")
    const lastValidEnd = Math.max(lastSelfClose, lastMxCellClose)
    if (lastValidEnd !== -1) {
        const endOffset = lastMxCellClose > lastSelfClose ? 9 : 2
        const suffix = content.slice(lastValidEnd + endOffset)
        // If suffix is only closing tags (wrapper tags), strip it
        if (/^(\s*<\/[^>]+>)*\s*$/.test(suffix)) {
            content = content.slice(0, lastValidEnd + endOffset)
        }
    }

    // Remove any existing root cells from content (LLM shouldn't include them, but handle it gracefully)
    // Use flexible patterns that match both self-closing (/>) and non-self-closing (></mxCell>) formats
    content = content
        .replace(/<mxCell[^>]*\bid=["']0["'][^>]*(?:\/>|><\/mxCell>)/g, "")
        .replace(/<mxCell[^>]*\bid=["']1["'][^>]*(?:\/>|><\/mxCell>)/g, "")
        .trim()

    return `<mxfile><diagram name="Page-1" id="page-1"><mxGraphModel><root>${ROOT_CELLS}${content}</root></mxGraphModel></diagram></mxfile>`
}

/**
 * Replace nodes in a Draw.io XML diagram
 * @param currentXML - The original Draw.io XML string
 * @param nodes - The XML string containing new nodes to replace in the diagram
 * @returns The updated XML string with replaced nodes
 */
export function replaceNodes(currentXML: string, nodes: string): string {
    // Check for valid inputs
    if (!currentXML || !nodes) {
        throw new Error("Both currentXML and nodes must be provided")
    }

    try {
        // Parse the XML strings to create DOM objects
        const parser = new DOMParser()
        const currentDoc = parser.parseFromString(currentXML, "text/xml")

        // Handle nodes input - if it doesn't contain <root>, wrap it
        let nodesString = nodes
        if (!nodes.includes("<root>")) {
            nodesString = `<root>${nodes}</root>`
        }

        const nodesDoc = parser.parseFromString(nodesString, "text/xml")

        // Find the root element in the current document
        let currentRoot = currentDoc.querySelector("mxGraphModel > root")
        if (!currentRoot) {
            // If no root element is found, create the proper structure
            const mxGraphModel =
                currentDoc.querySelector("mxGraphModel") ||
                currentDoc.createElement("mxGraphModel")

            if (!currentDoc.contains(mxGraphModel)) {
                currentDoc.appendChild(mxGraphModel)
            }

            currentRoot = currentDoc.createElement("root")
            mxGraphModel.appendChild(currentRoot)
        }

        // Find the root element in the nodes document
        const nodesRoot = nodesDoc.querySelector("root")
        if (!nodesRoot) {
            throw new Error(
                "Invalid nodes: Could not find or create <root> element",
            )
        }

        // Clear all existing child elements from the current root
        if (!currentRoot) throw new Error("Could not find or create root")
        while (currentRoot.firstChild) {
            currentRoot.removeChild(currentRoot.firstChild)
        }

        // Ensure the base cells exist
        const hasCell0 = Array.from(nodesRoot.childNodes).some(
            (node) =>
                node.nodeName === "mxCell" &&
                (node as Element).getAttribute("id") === "0",
        )

        const hasCell1 = Array.from(nodesRoot.childNodes).some(
            (node) =>
                node.nodeName === "mxCell" &&
                (node as Element).getAttribute("id") === "1",
        )

        // Copy all child nodes from the nodes root to the current root
        Array.from(nodesRoot.childNodes).forEach((node) => {
            const importedNode = currentDoc.importNode(node, true)
            currentRoot.appendChild(importedNode)
        })

        // Add default cells if they don't exist
        if (!hasCell0) {
            const cell0 = currentDoc.createElement("mxCell")
            cell0.setAttribute("id", "0")
            currentRoot.insertBefore(cell0, currentRoot.firstChild)
        }

        if (!hasCell1) {
            const cell1 = currentDoc.createElement("mxCell")
            cell1.setAttribute("id", "1")
            cell1.setAttribute("parent", "0")

            // Insert after cell0 if possible
            const cell0 = currentRoot.querySelector('mxCell[id="0"]')
            if (cell0?.nextSibling) {
                currentRoot.insertBefore(cell1, cell0.nextSibling)
            } else {
                currentRoot.appendChild(cell1)
            }
        }

        // Convert the modified DOM back to a string
        const serializer = new XMLSerializer()
        return serializer.serializeToString(currentDoc)
    } catch (error) {
        throw new Error(`Error replacing nodes: ${error}`)
    }
}

// ============================================================================
// ID-based Diagram Operations
// ============================================================================

export interface OperationError {
    type: "update" | "add" | "delete"
    cellId: string
    message: string
}

export interface ApplyOperationsResult {
    result: string
    errors: OperationError[]
}

/**
 * Apply diagram operations (update/add/delete) using ID-based lookup.
 * This replaces the text-matching approach with direct DOM manipulation.
 *
 * @param xmlContent - The full mxfile XML content
 * @param operations - Array of operations to apply
 * @returns Object with result XML and any errors
 */
export function applyDiagramOperations(
    xmlContent: string,
    operations: DiagramOperation[],
): ApplyOperationsResult {
    const errors: OperationError[] = []

    // Parse the XML
    const parser = new DOMParser()
    const doc = parser.parseFromString(xmlContent, "text/xml")

    // Check for parse errors
    const parseError = doc.querySelector("parsererror")
    if (parseError) {
        return {
            result: xmlContent,
            errors: [
                {
                    type: "update",
                    cellId: "",
                    message: `XML parse error: ${parseError.textContent}`,
                },
            ],
        }
    }

    // Find the root element (inside mxGraphModel)
    const root = doc.querySelector("root")
    if (!root) {
        return {
            result: xmlContent,
            errors: [
                {
                    type: "update",
                    cellId: "",
                    message: "Could not find <root> element in XML",
                },
            ],
        }
    }

    // Build a map of cell IDs to elements
    const cellMap = new Map<string, Element>()
    root.querySelectorAll("mxCell").forEach((cell) => {
        const id = cell.getAttribute("id")
        if (id) cellMap.set(id, cell)
    })

    // Process each operation
    for (const op of operations) {
        if (op.operation === "update") {
            const existingCell = cellMap.get(op.cell_id)
            if (!existingCell) {
                errors.push({
                    type: "update",
                    cellId: op.cell_id,
                    message: `Cell with id="${op.cell_id}" not found`,
                })
                continue
            }

            if (!op.new_xml) {
                errors.push({
                    type: "update",
                    cellId: op.cell_id,
                    message: "new_xml is required for update operation",
                })
                continue
            }

            // Auto-fix new_xml before parsing (unescaped quotes etc.)
            const autoFixResultUpdate = autoFixXml(op.new_xml)
            const fixedNewXml =
                autoFixResultUpdate.fixes.length > 0
                    ? autoFixResultUpdate.fixed
                    : op.new_xml
            if (autoFixResultUpdate.fixes.length > 0) {
                console.log(
                    `[applyDiagramOperations] Auto-fixed new_xml for cell_id="${op.cell_id}": ${autoFixResultUpdate.fixes.join(", ")}`,
                )
            }

            // Parse the new XML
            const newDoc = parser.parseFromString(
                `<wrapper>${fixedNewXml}</wrapper>`,
                "text/xml",
            )
            const newCell = newDoc.querySelector("mxCell")
            if (!newCell) {
                errors.push({
                    type: "update",
                    cellId: op.cell_id,
                    message: "new_xml must contain an mxCell element",
                })
                continue
            }

            // Validate ID matches
            const newCellId = newCell.getAttribute("id")
            if (newCellId !== op.cell_id) {
                errors.push({
                    type: "update",
                    cellId: op.cell_id,
                    message: `ID mismatch: cell_id is "${op.cell_id}" but new_xml has id="${newCellId}"`,
                })
                continue
            }

            // Import and replace the node
            const importedNode = doc.importNode(newCell, true)
            existingCell.parentNode?.replaceChild(importedNode, existingCell)

            // Update the map with the new element
            cellMap.set(op.cell_id, importedNode)
        } else if (op.operation === "add") {
            // Check if ID already exists
            if (cellMap.has(op.cell_id)) {
                errors.push({
                    type: "add",
                    cellId: op.cell_id,
                    message: `Cell with id="${op.cell_id}" already exists`,
                })
                continue
            }

            if (!op.new_xml) {
                errors.push({
                    type: "add",
                    cellId: op.cell_id,
                    message: "new_xml is required for add operation",
                })
                continue
            }

            // Auto-fix new_xml before parsing (unescaped quotes etc.)
            const autoFixResultAdd = autoFixXml(op.new_xml)
            const fixedNewXmlAdd =
                autoFixResultAdd.fixes.length > 0
                    ? autoFixResultAdd.fixed
                    : op.new_xml
            if (autoFixResultAdd.fixes.length > 0) {
                console.log(
                    `[applyDiagramOperations] Auto-fixed new_xml for cell_id="${op.cell_id}": ${autoFixResultAdd.fixes.join(", ")}`,
                )
            }

            // Parse the new XML
            const newDoc = parser.parseFromString(
                `<wrapper>${fixedNewXmlAdd}</wrapper>`,
                "text/xml",
            )
            const newCell = newDoc.querySelector("mxCell")
            if (!newCell) {
                errors.push({
                    type: "add",
                    cellId: op.cell_id,
                    message: "new_xml must contain an mxCell element",
                })
                continue
            }

            // Validate ID matches
            const newCellId = newCell.getAttribute("id")
            if (newCellId !== op.cell_id) {
                errors.push({
                    type: "add",
                    cellId: op.cell_id,
                    message: `ID mismatch: cell_id is "${op.cell_id}" but new_xml has id="${newCellId}"`,
                })
                continue
            }

            // Validate parent exists (if specified)
            const parentAttr = newCell.getAttribute("parent")
            if (
                parentAttr &&
                parentAttr !== "0" &&
                parentAttr !== "1" &&
                !cellMap.has(parentAttr)
            ) {
                errors.push({
                    type: "add",
                    cellId: op.cell_id,
                    message: `Parent "${parentAttr}" does not exist in the current diagram`,
                })
                continue
            }

            // Import and append the node
            const importedNode = doc.importNode(newCell, true)
            root.appendChild(importedNode)

            // Add to map
            cellMap.set(op.cell_id, importedNode)
        } else if (op.operation === "delete") {
            // Protect root cells from deletion
            if (op.cell_id === "0" || op.cell_id === "1") {
                errors.push({
                    type: "delete",
                    cellId: op.cell_id,
                    message: `Cannot delete root cell "${op.cell_id}"`,
                })
                continue
            }

            const existingCell = cellMap.get(op.cell_id)
            if (!existingCell) {
                // Cell not found - might have been cascade-deleted by a previous operation
                // Skip silently instead of erroring (AI may redundantly list children/edges)
                continue
            }

            // Cascade delete: collect all cells to delete (children + edges + self)
            const cellsToDelete = new Set<string>()

            // Recursive function to find all descendants
            const collectDescendants = (cellId: string) => {
                if (cellsToDelete.has(cellId)) return
                cellsToDelete.add(cellId)

                // Find children (cells where parent === cellId)
                const children = root.querySelectorAll(
                    `mxCell[parent="${cellId}"]`,
                )
                children.forEach((child) => {
                    const childId = child.getAttribute("id")
                    if (childId && childId !== "0" && childId !== "1") {
                        collectDescendants(childId)
                    }
                })
            }

            // Collect the target cell and all its descendants
            collectDescendants(op.cell_id)

            // Find edges referencing any of the cells to be deleted
            // Also recursively collect children of those edges (e.g., edge labels)
            for (const cellId of cellsToDelete) {
                const referencingEdges = root.querySelectorAll(
                    `mxCell[source="${cellId}"], mxCell[target="${cellId}"]`,
                )
                referencingEdges.forEach((edge) => {
                    const edgeId = edge.getAttribute("id")
                    // Protect root cells from being added via edge references
                    if (edgeId && edgeId !== "0" && edgeId !== "1") {
                        // Recurse to collect edge's children (like labels)
                        collectDescendants(edgeId)
                    }
                })
            }

            // Log what will be deleted
            if (cellsToDelete.size > 1) {
                console.log(
                    `[applyDiagramOperations] Cascade delete "${op.cell_id}" → deleting ${cellsToDelete.size} cells: ${Array.from(cellsToDelete).join(", ")}`,
                )
            }

            // Delete all collected cells
            for (const cellId of cellsToDelete) {
                const cell = cellMap.get(cellId)
                if (cell) {
                    cell.parentNode?.removeChild(cell)
                    cellMap.delete(cellId)
                }
            }
        }
    }

    // Serialize back to string
    const serializer = new XMLSerializer()
    const result = serializer.serializeToString(doc)

    return { result, errors }
}

// ============================================================================
// Layout Post-Processing (整形) Algorithm
// ============================================================================

/**
 * 基于碰撞消除的增量布局算法。
 *
 * 核心原则：
 * 1. 保留模型生成的原始布局意图（位置、分组、语义关系）
 * 2. 只对有碰撞的元素做最小位移调整
 * 3. 先处理容器内子节点碰撞，再调整容器尺寸适配
 * 4. 最后处理顶层元素碰撞
 * 5. 边不修改
 *
 * draw.io 关键特性：子节点坐标是相对于父容器的。
 */

const LAYOUT_GAP = 30
const LAYOUT_CONTAINER_PADDING = 30

interface CellGeo {
    id: string
    parent: string
    x: number
    y: number
    w: number
    h: number
}

function rectsOverlap(a: CellGeo, b: CellGeo): boolean {
    return (
        a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
    )
}

function parseAllCells(doc: Document): CellGeo[] {
    const cells: CellGeo[] = []
    doc.querySelectorAll("mxCell").forEach((el) => {
        const id = el.getAttribute("id") || ""
        if (id === "0" || id === "1") return
        const geo = el.querySelector("mxGeometry")
        if (!geo) return
        const w = parseFloat(geo.getAttribute("width") || "0") || 0
        const h = parseFloat(geo.getAttribute("height") || "0") || 0
        if (w === 0 && h === 0) return
        cells.push({
            id,
            parent: el.getAttribute("parent") || "",
            x: parseFloat(geo.getAttribute("x") || "0") || 0,
            y: parseFloat(geo.getAttribute("y") || "0") || 0,
            w,
            h,
        })
    })
    return cells
}

function getCellEl(doc: Document, id: string): Element | null {
    return doc.querySelector(`mxCell[id="${id}"]`)
}

function setGeo(el: Element, x: number, y: number, w?: number, h?: number) {
    let geo = el.querySelector("mxGeometry")
    if (!geo) {
        geo = el.ownerDocument.createElement("mxGeometry")
        geo.setAttribute("as", "geometry")
        el.appendChild(geo)
    }
    geo.setAttribute("x", String(Math.round(x)))
    geo.setAttribute("y", String(Math.round(y)))
    if (w !== undefined) geo.setAttribute("width", String(Math.round(w)))
    if (h !== undefined) geo.setAttribute("height", String(Math.round(h)))
}

function isContainerCell(el: Element, childrenCount: number): boolean {
    if (childrenCount === 0) return false
    const style = el.getAttribute("style") || ""
    if (style.includes("startSize")) return true
    const vertex = el.getAttribute("vertex") === "1"
    if (vertex && childrenCount >= 2) return true
    return false
}

/**
 * 判断是否为顶层容器（用于阶段 2 区分容器和独立节点）。
 * 不依赖 childrenCount（因为顶层容器可能不在 childrenMap 中），
 * 而是检查 style 是否包含 startSize，或是否是其他 vertex 元素的 parent。
 */
function isTopLevelContainer(
    el: Element,
    elMap: Map<string, Element | null>,
    cells: CellGeo[],
): boolean {
    // 方式 1：检查 style 是否包含 startSize（draw.io 容器标志）
    const style = el.getAttribute("style") || ""
    if (style.includes("startSize")) return true
    // 方式 2：检查是否是其他 vertex 元素的 parent
    const id = el.getAttribute("id")
    if (id) {
        const hasChildVertex = cells.some((c) => {
            if (c.parent !== id) return false
            const childEl = elMap.get(c.id)
            return childEl && childEl.getAttribute("vertex") === "1"
        })
        if (hasChildVertex) return true
    }
    return false
}

/**
 * 将一组几何体按 y 坐标分组为"行"。
 * 两个元素中心 y 距离小于阈值时视为同一行。
 */
function groupIntoRows(geos: CellGeo[], rowThreshold: number): CellGeo[][] {
    const sorted = [...geos].sort((a, b) => a.y + a.h / 2 - (b.y + b.h / 2))
    const rows: CellGeo[][] = []
    for (const g of sorted) {
        const centerY = g.y + g.h / 2
        // 尝试放入已有行：与该行第一个元素的中心 y 距离在阈值内
        let placed = false
        for (const row of rows) {
            const rowRefY = row[0].y + row[0].h / 2
            if (Math.abs(centerY - rowRefY) < rowThreshold) {
                row.push(g)
                placed = true
                break
            }
        }
        if (!placed) {
            rows.push([g])
        }
    }
    return rows
}

/**
 * 消除一组兄弟节点之间的碰撞。
 *
 * 策略：
 * 1. 按 y 坐标将元素分组为"行"（中心 y 距离 < 最大高度的一半视为同行）
 * 2. 对每行内元素按 x 排序，消除水平碰撞（将右侧节点向右推）
 * 3. 对不同行之间消除垂直碰撞（将下方行整体向下推，保持行内相对位置）
 * 4. 保持最小位移，避免级联偏移过大
 */
function resolveSiblingCollisions(geos: CellGeo[], gap: number) {
    if (geos.length < 2) return

    // 动态计算行分组阈值：取所有元素最小高度的 30%，只有 y 非常接近的才算同行
    const minHeight = Math.min(...geos.map((g) => g.h))
    const rowThreshold = Math.max(minHeight * 0.3, 1)

    // 步骤 1：按 y 分组为行
    const rows = groupIntoRows(geos, rowThreshold)

    // 步骤 2：对每行内元素按 x 排序，消除水平碰撞
    for (const row of rows) {
        if (row.length < 2) continue
        row.sort((a, b) => a.x - b.x)
        for (let i = 0; i < row.length - 1; i++) {
            const a = row[i]
            const b = row[i + 1]
            // 只检查水平方向是否重叠（同行元素 y 方向已有间隙）
            const overlapX = a.x + a.w - b.x
            if (overlapX > 0) {
                const push = overlapX + gap
                b.x += push
            }
        }
    }

    // 步骤 3：消除不同行之间的垂直碰撞
    // 对行按 y 排序后，依次检查相邻行之间是否有垂直重叠
    if (rows.length < 2) return
    rows.sort((a, b) => a[0].y + a[0].h / 2 - (b[0].y + b[0].h / 2))

    for (let r = 0; r < rows.length - 1; r++) {
        const upperRow = rows[r]
        const lowerRow = rows[r + 1]

        // 上行的最底端
        const upperBottom = Math.max(...upperRow.map((g) => g.y + g.h))
        // 下行的最顶端
        const lowerTop = Math.min(...lowerRow.map((g) => g.y))

        const overlapY = upperBottom - lowerTop
        if (overlapY > 0) {
            const push = overlapY + gap
            // 将下行所有元素整体下移
            for (const g of lowerRow) {
                g.y += push
            }
        }
    }
}

/**
 * 调整容器尺寸以适配其子节点 + 内边距。
 * 同时确保容器内没有子节点超出边界。
 */
function fitContainerToChildren(
    containerEl: Element,
    children: CellGeo[],
    padding: number,
) {
    if (children.length === 0) return

    let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity
    for (const c of children) {
        minX = Math.min(minX, c.x)
        minY = Math.min(minY, c.y)
        maxX = Math.max(maxX, c.x + c.w)
        maxY = Math.max(maxY, c.y + c.h)
    }

    const neededW = Math.max(maxX - minX, 0) + padding * 2
    const neededH = Math.max(maxY - minY, 0) + padding * 2

    const geo = containerEl.querySelector("mxGeometry")
    if (!geo) return

    const curW = parseFloat(geo.getAttribute("width") || "0") || 0
    const curH = parseFloat(geo.getAttribute("height") || "0") || 0

    // 只扩大不缩小，保留模型设定的尺寸意图
    const newW = Math.max(curW, neededW)
    const newH = Math.max(curH, neededH)

    geo.setAttribute("width", String(Math.round(newW)))
    geo.setAttribute("height", String(Math.round(newH)))

    // 如果子节点有负坐标（超出容器左/上边界），整体偏移子节点
    if (minX < padding) {
        const offsetX = padding - minX
        for (const c of children) {
            const el = getCellEl(containerEl.ownerDocument, c.id)
            if (el) {
                const cGeo = el.querySelector("mxGeometry")
                if (cGeo) {
                    const cx = parseFloat(cGeo.getAttribute("x") || "0") || 0
                    cGeo.setAttribute("x", String(Math.round(cx + offsetX)))
                }
            }
        }
    }
    if (minY < padding) {
        const offsetY = padding - minY
        for (const c of children) {
            const el = getCellEl(containerEl.ownerDocument, c.id)
            if (el) {
                const cGeo = el.querySelector("mxGeometry")
                if (cGeo) {
                    const cy = parseFloat(cGeo.getAttribute("y") || "0") || 0
                    cGeo.setAttribute("y", String(Math.round(cy + offsetY)))
                }
            }
        }
    }
}

/**
 * 对 draw.io 图表 XML 进行自动布局。
 * 只做碰撞消除，保留原始布局意图。
 *
 * @param xml - 完整 mxfile XML 或纯 mxCell XML
 * @returns 重新布局后的 XML
 */
export function applyAutoLayout(xml: string): string {
    if (!xml || !xml.trim()) return xml

    const parser = new DOMParser()
    const doc = parser.parseFromString(xml, "text/xml")
    if (doc.querySelector("parsererror")) {
        console.warn("[applyAutoLayout] XML 解析失败，跳过布局")
        return xml
    }

    const cells = parseAllCells(doc)
    if (cells.length === 0) return xml

    // 构建 parent → children 映射
    const childrenMap = new Map<string, CellGeo[]>()
    for (const cell of cells) {
        if (!childrenMap.has(cell.parent)) childrenMap.set(cell.parent, [])
        childrenMap.get(cell.parent)!.push(cell)
    }

    // 构建 id → element 映射
    const elMap = new Map<string, Element>()
    doc.querySelectorAll("mxCell").forEach((el) => {
        const id = el.getAttribute("id") || ""
        if (id) elMap.set(id, el)
    })

    // 阶段 1：处理每个容器内部的子节点碰撞 + 容器尺寸适配
    for (const [parentId, children] of childrenMap) {
        const parentEl = elMap.get(parentId)
        if (!parentEl) continue

        const vertexChildren = children.filter((c) => {
            const el = elMap.get(c.id)
            return (
                el &&
                el.getAttribute("vertex") === "1" &&
                el.getAttribute("edge") !== "1"
            )
        })

        if (!isContainerCell(parentEl, vertexChildren.length)) continue

        // 1a. 递归处理嵌套容器
        const nestedContainers = vertexChildren.filter((c) => {
            const nestedChildren = childrenMap.get(c.id)
            if (!nestedChildren) return false
            const nestedEl = elMap.get(c.id)
            return (
                nestedEl &&
                isContainerCell(
                    nestedEl,
                    nestedChildren.filter((nc) => {
                        const nEl = elMap.get(nc.id)
                        return nEl && nEl.getAttribute("vertex") === "1"
                    }).length,
                )
            )
        })

        for (const nc of nestedContainers) {
            const ncChildren = childrenMap.get(nc.id) || []
            const ncVertex = ncChildren.filter((c) => {
                const el = elMap.get(c.id)
                return el && el.getAttribute("vertex") === "1"
            })
            resolveSiblingCollisions(ncVertex, LAYOUT_GAP)
            const ncEl = elMap.get(nc.id)
            if (ncEl)
                fitContainerToChildren(ncEl, ncVertex, LAYOUT_CONTAINER_PADDING)
            // 同步嵌套容器的子节点位置到 DOM
            for (const c of ncVertex) {
                const el = elMap.get(c.id)
                if (el) setGeo(el, c.x, c.y)
            }
        }

        // 1b. 消除子节点碰撞
        resolveSiblingCollisions(vertexChildren, LAYOUT_GAP)

        // 1b2. 将碰撞消除后的位置写回 DOM
        for (const c of vertexChildren) {
            const el = elMap.get(c.id)
            if (el) {
                setGeo(el, c.x, c.y)
            }
        }

        // 1c. 调整容器尺寸适配子节点
        fitContainerToChildren(
            parentEl,
            vertexChildren,
            LAYOUT_CONTAINER_PADDING,
        )

        // 1d. 重新读取更新后的 geometry（包括 fitContainerToChildren 可能的偏移）
        for (const c of children) {
            const el = elMap.get(c.id)
            if (!el) continue
            const geo = el.querySelector("mxGeometry")
            if (!geo) continue
            c.x = parseFloat(geo.getAttribute("x") || "0") || 0
            c.y = parseFloat(geo.getAttribute("y") || "0") || 0
            c.w = parseFloat(geo.getAttribute("width") || "0") || 0
            c.h = parseFloat(geo.getAttribute("height") || "0") || 0
        }
    }

    // 阶段 2：处理顶层元素（parent="1"）的碰撞
    const topCells = cells.filter((c) => c.parent === "1")
    const topVertex = topCells.filter((c) => {
        const el = elMap.get(c.id)
        return (
            el &&
            el.getAttribute("vertex") === "1" &&
            el.getAttribute("edge") !== "1"
        )
    })

    // 将顶层元素分为容器和独立节点
    const topContainers: CellGeo[] = []
    const topStandaloneNodes: CellGeo[] = []
    for (const c of topVertex) {
        const el = elMap.get(c.id)
        if (el && isTopLevelContainer(el, elMap, cells)) {
            topContainers.push(c)
        } else {
            topStandaloneNodes.push(c)
        }
    }

    // 只对独立节点做碰撞消除（容器之间不碰撞消除）
    if (topStandaloneNodes.length >= 2) {
        resolveSiblingCollisions(topStandaloneNodes, LAYOUT_GAP)
        for (const c of topStandaloneNodes) {
            const el = elMap.get(c.id)
            if (el) setGeo(el, c.x, c.y)
        }
    }

    // 容器只做尺寸适配，不做位移
    for (const c of topContainers) {
        const el = elMap.get(c.id)
        if (el) {
            const containerChildren = childrenMap.get(c.id) || []
            const containerVertex = containerChildren.filter((cc) => {
                const ccEl = elMap.get(cc.id)
                return ccEl && ccEl.getAttribute("vertex") === "1"
            })
            fitContainerToChildren(
                el,
                containerVertex,
                LAYOUT_CONTAINER_PADDING,
            )
        }
    }

    return new XMLSerializer().serializeToString(doc)
}

// ============================================================================
// Validation Helper Functions
// ============================================================================

/** Check for duplicate structural attributes in a tag */
function checkDuplicateAttributes(xml: string): string | null {
    const structuralSet = new Set(STRUCTURAL_ATTRS)
    const tagPattern = /<[^>]+>/g
    let tagMatch
    while ((tagMatch = tagPattern.exec(xml)) !== null) {
        const tag = tagMatch[0]
        const attrPattern = /\s([a-zA-Z_:][a-zA-Z0-9_:.-]*)\s*=/g
        const attributes = new Map<string, number>()
        let attrMatch
        while ((attrMatch = attrPattern.exec(tag)) !== null) {
            const attrName = attrMatch[1]
            attributes.set(attrName, (attributes.get(attrName) || 0) + 1)
        }
        const duplicates = Array.from(attributes.entries())
            .filter(([name, count]) => count > 1 && structuralSet.has(name))
            .map(([name]) => name)
        if (duplicates.length > 0) {
            return `Invalid XML: Duplicate structural attribute(s): ${duplicates.join(", ")}. Remove duplicate attributes.`
        }
    }
    return null
}

/** Check for duplicate IDs in XML */
function checkDuplicateIds(xml: string): string | null {
    const idPattern = /\bid\s*=\s*["']([^"']+)["']/gi
    const ids = new Map<string, number>()
    let idMatch
    while ((idMatch = idPattern.exec(xml)) !== null) {
        const id = idMatch[1]
        ids.set(id, (ids.get(id) || 0) + 1)
    }
    const duplicateIds = Array.from(ids.entries())
        .filter(([, count]) => count > 1)
        .map(([id, count]) => `'${id}' (${count}x)`)
    if (duplicateIds.length > 0) {
        return `Invalid XML: Found duplicate ID(s): ${duplicateIds.slice(0, 3).join(", ")}. All id attributes must be unique.`
    }
    return null
}

/** Check for tag mismatches using parsed tags */
function checkTagMismatches(xml: string): string | null {
    const xmlWithoutComments = xml.replace(/<!--[\s\S]*?-->/g, "")
    const tags = parseXmlTags(xmlWithoutComments)
    const tagStack: string[] = []

    for (const { tagName, isClosing, isSelfClosing } of tags) {
        if (isClosing) {
            if (tagStack.length === 0) {
                return `Invalid XML: Closing tag </${tagName}> without matching opening tag`
            }
            const expected = tagStack.pop()
            if (expected?.toLowerCase() !== tagName.toLowerCase()) {
                return `Invalid XML: Expected closing tag </${expected}> but found </${tagName}>`
            }
        } else if (!isSelfClosing) {
            tagStack.push(tagName)
        }
    }
    if (tagStack.length > 0) {
        return `Invalid XML: Document has ${tagStack.length} unclosed tag(s): ${tagStack.join(", ")}`
    }
    return null
}

/** Check for invalid character references */
function checkCharacterReferences(xml: string): string | null {
    const charRefPattern = /&#x?[^;]+;?/g
    let charMatch
    while ((charMatch = charRefPattern.exec(xml)) !== null) {
        const ref = charMatch[0]
        if (ref.startsWith("&#x")) {
            if (!ref.endsWith(";")) {
                return `Invalid XML: Missing semicolon after hex reference: ${ref}`
            }
            const hexDigits = ref.substring(3, ref.length - 1)
            if (hexDigits.length === 0 || !/^[0-9a-fA-F]+$/.test(hexDigits)) {
                return `Invalid XML: Invalid hex character reference: ${ref}`
            }
        } else if (ref.startsWith("&#")) {
            if (!ref.endsWith(";")) {
                return `Invalid XML: Missing semicolon after decimal reference: ${ref}`
            }
            const decDigits = ref.substring(2, ref.length - 1)
            if (decDigits.length === 0 || !/^[0-9]+$/.test(decDigits)) {
                return `Invalid XML: Invalid decimal character reference: ${ref}`
            }
        }
    }
    return null
}

/** Check for invalid entity references */
function checkEntityReferences(xml: string): string | null {
    const xmlWithoutComments = xml.replace(/<!--[\s\S]*?-->/g, "")
    const bareAmpPattern = /&(?!(?:lt|gt|amp|quot|apos|#))/g
    if (bareAmpPattern.test(xmlWithoutComments)) {
        return "Invalid XML: Found unescaped & character(s). Replace & with &amp;"
    }
    const invalidEntityPattern = /&([a-zA-Z][a-zA-Z0-9]*);/g
    let entityMatch
    while (
        (entityMatch = invalidEntityPattern.exec(xmlWithoutComments)) !== null
    ) {
        if (!VALID_ENTITIES.has(entityMatch[1])) {
            return `Invalid XML: Invalid entity reference: &${entityMatch[1]}; - use only valid XML entities (lt, gt, amp, quot, apos)`
        }
    }
    return null
}

/** Check for nested mxCell tags using regex */
function checkNestedMxCells(xml: string): string | null {
    const cellTagPattern = /<\/?mxCell[^>]*>/g
    const cellStack: number[] = []
    let cellMatch
    while ((cellMatch = cellTagPattern.exec(xml)) !== null) {
        const tag = cellMatch[0]
        if (tag.startsWith("</mxCell>")) {
            if (cellStack.length > 0) cellStack.pop()
        } else if (!tag.endsWith("/>")) {
            const isLabelOrGeometry =
                /\sas\s*=\s*["'](valueLabel|geometry)["']/.test(tag)
            if (!isLabelOrGeometry) {
                cellStack.push(cellMatch.index)
                if (cellStack.length > 1) {
                    return "Invalid XML: Found nested mxCell tags. Cells should be siblings, not nested inside other mxCell elements."
                }
            }
        }
    }
    return null
}

/**
 * Validates draw.io XML structure for common issues
 * Uses DOM parsing + additional regex checks for high accuracy
 * @param xml - The XML string to validate
 * @returns null if valid, error message string if invalid
 */
export function validateMxCellStructure(xml: string): string | null {
    // Size check for performance
    if (xml.length > MAX_XML_SIZE) {
        console.warn(
            `[validateMxCellStructure] XML size (${xml.length}) exceeds ${MAX_XML_SIZE} bytes, may cause performance issues`,
        )
    }

    // 0. First use DOM parser to catch syntax errors (most accurate)
    try {
        const parser = new DOMParser()
        const doc = parser.parseFromString(xml, "text/xml")
        const parseError = doc.querySelector("parsererror")
        if (parseError) {
            return `Invalid XML: The XML contains syntax errors (likely unescaped special characters). Please escape: < → &lt;, > → &gt;, & → &amp;, " → &quot;. WARNING: DO NOT regenerate the entire diagram. Only re-output the specific cell(s) with unescaped characters.`
        }

        // DOM-based checks for nested mxCell
        const allCells = doc.querySelectorAll("mxCell")
        for (const cell of allCells) {
            if (cell.parentElement?.tagName === "mxCell") {
                const id = cell.getAttribute("id") || "unknown"
                return `Invalid XML: Found nested mxCell (id="${id}"). Cells should be siblings, not nested inside other mxCell elements.`
            }
        }
    } catch (error) {
        // Log unexpected DOMParser errors before falling back to regex checks
        console.warn(
            "[validateMxCellStructure] DOMParser threw unexpected error, falling back to regex validation:",
            error,
        )
    }

    // 1. Check for CDATA wrapper (invalid at document root)
    if (/^\s*<!\[CDATA\[/.test(xml)) {
        return "Invalid XML: XML is wrapped in CDATA section - remove <![CDATA[ from start and ]]> from end"
    }

    // 2. Check for duplicate structural attributes
    const dupAttrError = checkDuplicateAttributes(xml)
    if (dupAttrError) {
        return dupAttrError
    }

    // 3. Check for unescaped < in attribute values
    const attrValuePattern = /=\s*"([^"]*)"/g
    let attrValMatch
    while ((attrValMatch = attrValuePattern.exec(xml)) !== null) {
        const value = attrValMatch[1]
        if (/</.test(value) && !/&lt;/.test(value)) {
            return "Invalid XML: Unescaped < character in attribute values. Replace < with &lt;"
        }
    }

    // 4. Check for duplicate IDs
    const dupIdError = checkDuplicateIds(xml)
    if (dupIdError) {
        return dupIdError
    }

    // 5. Check for tag mismatches
    const tagMismatchError = checkTagMismatches(xml)
    if (tagMismatchError) {
        return tagMismatchError
    }

    // 6. Check invalid character references
    const charRefError = checkCharacterReferences(xml)
    if (charRefError) {
        return charRefError
    }

    // 7. Check for invalid comment syntax (-- inside comments)
    const commentPattern = /<!--([\s\S]*?)-->/g
    let commentMatch
    while ((commentMatch = commentPattern.exec(xml)) !== null) {
        if (/--/.test(commentMatch[1])) {
            return "Invalid XML: Comment contains -- (double hyphen) which is not allowed"
        }
    }

    // 8. Check for unescaped entity references and invalid entity names
    const entityError = checkEntityReferences(xml)
    if (entityError) {
        return entityError
    }

    // 9. Check for empty id attributes on mxCell
    if (/<mxCell[^>]*\sid\s*=\s*["']\s*["'][^>]*>/g.test(xml)) {
        return "Invalid XML: Found mxCell element(s) with empty id attribute"
    }

    // 10. Check for nested mxCell tags
    const nestedCellError = checkNestedMxCells(xml)
    if (nestedCellError) {
        return nestedCellError
    }

    return null
}

/**
 * Attempts to auto-fix common XML issues in draw.io diagrams
 * @param xml - The XML string to fix
 * @returns Object with fixed XML and list of fixes applied
 */
export function autoFixXml(xml: string): { fixed: string; fixes: string[] } {
    let fixed = xml
    const fixes: string[] = []

    // 0. Fix JSON-escaped XML (common when XML is stored in JSON without unescaping)
    // Only apply when we see JSON-escaped attribute patterns like =\"value\"
    // Don't apply to legitimate \n in value attributes (draw.io uses these for line breaks)
    if (/=\\"/.test(fixed)) {
        // Replace literal \" with actual quotes
        fixed = fixed.replace(/\\"/g, '"')
        // Replace literal \n with actual newlines (only after confirming JSON-escaped)
        fixed = fixed.replace(/\\n/g, "\n")
        fixes.push("Fixed JSON-escaped XML")
    }

    // 1. Remove CDATA wrapper (MUST be before text-before-root check)
    if (/^\s*<!\[CDATA\[/.test(fixed)) {
        fixed = fixed.replace(/^\s*<!\[CDATA\[/, "").replace(/\]\]>\s*$/, "")
        fixes.push("Removed CDATA wrapper")
    }

    // 1b. Strip trailing LLM wrapper tags (DeepSeek, Anthropic, etc.)
    // These are closing tags after the last valid mxCell that break XML parsing
    const lastSelfClose = fixed.lastIndexOf("/>")
    const lastMxCellClose = fixed.lastIndexOf("</mxCell>")
    const lastValidEnd = Math.max(lastSelfClose, lastMxCellClose)
    if (lastValidEnd !== -1) {
        const endOffset = lastMxCellClose > lastSelfClose ? 9 : 2
        const suffix = fixed.slice(lastValidEnd + endOffset)
        // If suffix contains only closing tags (wrapper tags) or whitespace, strip it
        if (/^(\s*<\/[^>]+>)+\s*$/.test(suffix)) {
            fixed = fixed.slice(0, lastValidEnd + endOffset)
            fixes.push("Stripped trailing LLM wrapper tags")
        }
    }

    // 2. Remove text before XML declaration or root element (only if it's garbage text, not valid XML)
    const xmlStart = fixed.search(/<(\?xml|mxGraphModel|mxfile)/i)
    if (xmlStart > 0 && !/^<[a-zA-Z]/.test(fixed.trim())) {
        fixed = fixed.substring(xmlStart)
        fixes.push("Removed text before XML root")
    }

    // 2. Fix duplicate attributes (keep first occurrence, remove duplicates)
    let dupAttrFixed = false
    fixed = fixed.replace(/<[^>]+>/g, (tag) => {
        let newTag = tag

        for (const attr of STRUCTURAL_ATTRS) {
            // Find all occurrences of this attribute
            const attrRegex = new RegExp(
                `\\s${attr}\\s*=\\s*["'][^"']*["']`,
                "gi",
            )
            const matches = tag.match(attrRegex)

            if (matches && matches.length > 1) {
                // Keep first, remove others
                let firstKept = false
                newTag = newTag.replace(attrRegex, (m) => {
                    if (!firstKept) {
                        firstKept = true
                        return m
                    }
                    dupAttrFixed = true
                    return ""
                })
            }
        }
        return newTag
    })
    if (dupAttrFixed) {
        fixes.push("Removed duplicate structural attributes")
    }

    // 3. Fix unescaped & characters (but not valid entities)
    // Match & not followed by valid entity pattern
    const ampersandPattern =
        /&(?!(?:lt|gt|amp|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);)/g
    if (ampersandPattern.test(fixed)) {
        fixed = fixed.replace(
            /&(?!(?:lt|gt|amp|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);)/g,
            "&amp;",
        )
        fixes.push("Escaped unescaped & characters")
    }

    // 3. Fix invalid entity names like &ampquot; -> &quot;
    // Common mistake: double-escaping
    const invalidEntities = [
        { pattern: /&ampquot;/g, replacement: "&quot;", name: "&ampquot;" },
        { pattern: /&amplt;/g, replacement: "&lt;", name: "&amplt;" },
        { pattern: /&ampgt;/g, replacement: "&gt;", name: "&ampgt;" },
        { pattern: /&ampapos;/g, replacement: "&apos;", name: "&ampapos;" },
        { pattern: /&ampamp;/g, replacement: "&amp;", name: "&ampamp;" },
    ]
    for (const { pattern, replacement, name } of invalidEntities) {
        if (pattern.test(fixed)) {
            fixed = fixed.replace(pattern, replacement)
            fixes.push(`Fixed double-escaped entity ${name}`)
        }
    }

    // 3b. Fix malformed attribute values where &quot; is used as delimiter instead of actual quotes
    // Pattern: attr=&quot;value&quot; should become attr="value" (the &quot; was meant to be the quote delimiter)
    // This commonly happens with dashPattern=&quot;1 1;&quot;
    const malformedQuotePattern = /(\s[a-zA-Z][a-zA-Z0-9_:-]*)=&quot;/
    if (malformedQuotePattern.test(fixed)) {
        // Replace =&quot; with =" and trailing &quot; before next attribute or tag end with "
        fixed = fixed.replace(
            /(\s[a-zA-Z][a-zA-Z0-9_:-]*)=&quot;([^&]*?)&quot;/g,
            '$1="$2"',
        )
        fixes.push(
            'Fixed malformed attribute quotes (=&quot;...&quot; to ="...")',
        )
    }

    // 3c. Fix malformed closing tags like </tag/> -> </tag>
    const malformedClosingTag = /<\/([a-zA-Z][a-zA-Z0-9]*)\s*\/>/g
    if (malformedClosingTag.test(fixed)) {
        fixed = fixed.replace(/<\/([a-zA-Z][a-zA-Z0-9]*)\s*\/>/g, "</$1>")
        fixes.push("Fixed malformed closing tags (</tag/> to </tag>)")
    }

    // 3d. Fix missing space between attributes like vertex="1"parent="1"
    const missingSpacePattern = /("[^"]*")([a-zA-Z][a-zA-Z0-9_:-]*=)/g
    if (missingSpacePattern.test(fixed)) {
        fixed = fixed.replace(/("[^"]*")([a-zA-Z][a-zA-Z0-9_:-]*=)/g, "$1 $2")
        fixes.push("Added missing space between attributes")
    }

    // 3e. Fix unescaped quotes in style color values like fillColor="#fff2e6"
    // The " after Color= prematurely ends the style attribute. Remove it.
    // Pattern: ;fillColor="#fff → ;fillColor=#fff (remove first ", keep second as style closer)
    const quotedColorPattern = /;([a-zA-Z]*[Cc]olor)="#/
    if (quotedColorPattern.test(fixed)) {
        fixed = fixed.replace(/;([a-zA-Z]*[Cc]olor)="#/g, ";$1=#")
        fixes.push("Removed quotes around color values in style")
    }

    // 3f. Fix unescaped quotes inside attribute values
    // This handles cases like value="text "quoted" text" where inner quotes
    // should be escaped as &quot; to prevent XML parsing errors
    // IMPORTANT: Skip quotes that are already part of &quot; entities
    const hasUnescapedInnerQuotes = /="\s*[^"]*"[^"'\s>]/.test(fixed)
    if (hasUnescapedInnerQuotes) {
        let result = ""
        let i = 0

        while (i < fixed.length) {
            const c = fixed[i]

            if (c === '"' && i > 0 && fixed[i - 1] === "=") {
                // Opening quote of an attribute value
                result += c
                i++
                continue
            }

            if (c === '"') {
                // Check if this quote is part of &quot; entity (already escaped)
                // Look back: if preceded by &amp or just &, skip it
                const precededByEntity =
                    fixed.slice(Math.max(0, i - 6), i).endsWith("&amp") ||
                    fixed.slice(Math.max(0, i - 5), i).endsWith("&")
                // Look ahead: if this is &quot;, the next chars are uot;
                const isQuotEntity = fixed.slice(i + 1, i + 5) === "uot;"
                if (precededByEntity && isQuotEntity) {
                    // This is already &quot; - keep as-is
                    result += c
                    i++
                    continue
                }

                // Check if this is a closing quote (delimiter)
                // A closing quote is followed by: space+attr_name= OR > OR />
                const lookahead = fixed.slice(i + 1)
                const isFollowedByAttr =
                    /^[\s\n][a-zA-Z_][a-zA-Z0-9_:-]*\s*=/.test(lookahead)
                const isFollowedByTagEnd = /^[\s\n]*\/?>/.test(lookahead)

                if (isFollowedByAttr || isFollowedByTagEnd) {
                    // Closing quote - keep as delimiter
                    result += c
                } else {
                    // Content quote - escape it
                    result += "&quot;"
                }
                i++
                continue
            }

            result += c
            i++
        }

        fixed = result
        fixes.push("Escaped unescaped quotes inside attribute values")
    }

    // 4. Fix unescaped < and > in attribute values
    // < is required to be escaped, > is not strictly required but we escape for consistency
    const attrPattern = /(=\s*")([^"]*?)(<)([^"]*?)(")/g
    let attrMatch
    let hasUnescapedLt = false
    while ((attrMatch = attrPattern.exec(fixed)) !== null) {
        if (!attrMatch[3].startsWith("&lt;")) {
            hasUnescapedLt = true
            break
        }
    }
    if (hasUnescapedLt) {
        // Replace < and > with &lt; and &gt; inside attribute values
        fixed = fixed.replace(/=\s*"([^"]*)"/g, (_match, value) => {
            const escaped = value.replace(/</g, "&lt;").replace(/>/g, "&gt;")
            return `="${escaped}"`
        })
        fixes.push("Escaped <> characters in attribute values")
    }

    // 5. Fix invalid character references (remove malformed ones)
    // Pattern: &#x followed by non-hex chars before ;
    const invalidHexRefs: string[] = []
    fixed = fixed.replace(/&#x([^;]*);/g, (match, hex) => {
        if (/^[0-9a-fA-F]+$/.test(hex) && hex.length > 0) {
            return match // Valid hex ref, keep it
        }
        invalidHexRefs.push(match)
        return "" // Remove invalid ref
    })
    if (invalidHexRefs.length > 0) {
        fixes.push(
            `Removed ${invalidHexRefs.length} invalid hex character reference(s)`,
        )
    }

    // 6. Fix invalid decimal character references
    const invalidDecRefs: string[] = []
    fixed = fixed.replace(/&#([^x][^;]*);/g, (match, dec) => {
        if (/^[0-9]+$/.test(dec) && dec.length > 0) {
            return match // Valid decimal ref, keep it
        }
        invalidDecRefs.push(match)
        return "" // Remove invalid ref
    })
    if (invalidDecRefs.length > 0) {
        fixes.push(
            `Removed ${invalidDecRefs.length} invalid decimal character reference(s)`,
        )
    }

    // 7. Fix invalid comment syntax (replace -- with - repeatedly until none left)
    fixed = fixed.replace(/<!--([\s\S]*?)-->/g, (match, content) => {
        if (/--/.test(content)) {
            // Keep replacing until no double hyphens remain
            let fixedContent = content
            while (/--/.test(fixedContent)) {
                fixedContent = fixedContent.replace(/--/g, "-")
            }
            fixes.push("Fixed invalid comment syntax (removed double hyphens)")
            return `<!--${fixedContent}-->`
        }
        return match
    })

    // 8. Fix <Cell> tags that should be <mxCell> (common LLM mistake)
    // This handles both opening and closing tags
    const hasCellTags = /<\/?Cell[\s>]/i.test(fixed)
    if (hasCellTags) {
        console.log("[autoFixXml] Step 8: Found <Cell> tags to fix")
        const beforeFix = fixed
        fixed = fixed.replace(/<Cell(\s)/gi, "<mxCell$1")
        fixed = fixed.replace(/<Cell>/gi, "<mxCell>")
        fixed = fixed.replace(/<\/Cell>/gi, "</mxCell>")
        if (beforeFix !== fixed) {
            console.log("[autoFixXml] Step 8: Fixed <Cell> tags")
        }
        fixes.push("Fixed <Cell> tags to <mxCell>")
    }

    // 8b. Fix common closing tag typos (MUST run before foreign tag removal)
    const tagTypos = [
        { wrong: /<\/mxElement>/gi, right: "</mxCell>", name: "</mxElement>" },
        { wrong: /<\/mxcell>/g, right: "</mxCell>", name: "</mxcell>" }, // case sensitivity
        {
            wrong: /<\/mxgeometry>/g,
            right: "</mxGeometry>",
            name: "</mxgeometry>",
        },
        { wrong: /<\/mxpoint>/g, right: "</mxPoint>", name: "</mxpoint>" },
        {
            wrong: /<\/mxgraphmodel>/gi,
            right: "</mxGraphModel>",
            name: "</mxgraphmodel>",
        },
    ]
    for (const { wrong, right, name } of tagTypos) {
        const before = fixed
        fixed = fixed.replace(wrong, right)
        if (fixed !== before) {
            fixes.push(`Fixed typo ${name} to ${right}`)
        }
    }

    // 8c. Remove non-draw.io tags (after typo fixes so lowercase variants are fixed first)
    // IMPORTANT: Only remove tags at the element level, NOT inside quoted attribute values
    // Tags like <b>, <br> inside value="<b>text</b>" should be preserved (they're HTML content)
    const validDrawioTags = new Set([
        "mxfile",
        "diagram",
        "mxGraphModel",
        "root",
        "mxCell",
        "mxGeometry",
        "mxPoint",
        "Array",
        "Object",
        "mxRectangle",
    ])

    // Helper: Check if a position is inside a quoted attribute value
    // by counting unescaped quotes before that position
    const isInsideQuotes = (str: string, pos: number): boolean => {
        let inQuote = false
        let quoteChar = ""
        for (let i = 0; i < pos && i < str.length; i++) {
            const c = str[i]
            if (inQuote) {
                if (c === quoteChar) inQuote = false
            } else if (c === '"' || c === "'") {
                // Check if this quote is part of an attribute (preceded by =)
                // Look back for = sign
                let j = i - 1
                while (j >= 0 && /\s/.test(str[j])) j--
                if (j >= 0 && str[j] === "=") {
                    inQuote = true
                    quoteChar = c
                }
            }
        }
        return inQuote
    }

    const foreignTagPattern = /<\/?([a-zA-Z][a-zA-Z0-9_]*)[^>]*>/g
    let foreignMatch
    const foreignTags = new Set<string>()
    const foreignTagPositions: Array<{
        tag: string
        start: number
        end: number
    }> = []

    while ((foreignMatch = foreignTagPattern.exec(fixed)) !== null) {
        const tagName = foreignMatch[1]
        // Skip if this is a valid draw.io tag
        if (validDrawioTags.has(tagName)) continue
        // Skip if this tag is inside a quoted attribute value
        if (isInsideQuotes(fixed, foreignMatch.index)) continue

        foreignTags.add(tagName)
        foreignTagPositions.push({
            tag: tagName,
            start: foreignMatch.index,
            end: foreignMatch.index + foreignMatch[0].length,
        })
    }

    if (foreignTagPositions.length > 0) {
        // Remove tags from end to start to preserve indices
        foreignTagPositions.sort((a, b) => b.start - a.start)
        for (const { start, end } of foreignTagPositions) {
            fixed = fixed.slice(0, start) + fixed.slice(end)
        }
        fixes.push(
            `Removed foreign tags: ${Array.from(foreignTags).join(", ")}`,
        )
    }

    // 10. Fix unclosed tags by appending missing closing tags
    // Use parseXmlTags helper to track open tags
    const tagStack: string[] = []
    const parsedTags = parseXmlTags(fixed)

    for (const { tagName, isClosing, isSelfClosing } of parsedTags) {
        if (isClosing) {
            // Find matching opening tag (may not be the last one if there's mismatch)
            const lastIdx = tagStack.lastIndexOf(tagName)
            if (lastIdx !== -1) {
                tagStack.splice(lastIdx, 1)
            }
        } else if (!isSelfClosing) {
            tagStack.push(tagName)
        }
    }

    // If there are unclosed tags, append closing tags in reverse order
    // But first verify with simple count that they're actually unclosed
    if (tagStack.length > 0) {
        const tagsToClose: string[] = []
        for (const tagName of tagStack.reverse()) {
            // Simple count check: only close if opens > closes
            const openCount = (
                fixed.match(new RegExp(`<${tagName}[\\s>]`, "gi")) || []
            ).length
            const closeCount = (
                fixed.match(new RegExp(`</${tagName}>`, "gi")) || []
            ).length
            if (openCount > closeCount) {
                tagsToClose.push(tagName)
            }
        }
        if (tagsToClose.length > 0) {
            const closingTags = tagsToClose.map((t) => `</${t}>`).join("\n")
            fixed = fixed.trimEnd() + "\n" + closingTags
            fixes.push(
                `Closed ${tagsToClose.length} unclosed tag(s): ${tagsToClose.join(", ")}`,
            )
        }
    }

    // 10b. Remove extra closing tags (more closes than opens)
    // Need to properly count self-closing tags (they don't need closing tags)
    // IMPORTANT: Only count tags at element level, NOT inside quoted attribute values
    const tagCounts = new Map<
        string,
        { opens: number; closes: number; selfClosing: number }
    >()
    // Match full tags to detect self-closing by checking if ends with />
    const fullTagPattern = /<(\/?[a-zA-Z][a-zA-Z0-9]*)[^>]*>/g
    let tagCountMatch
    while ((tagCountMatch = fullTagPattern.exec(fixed)) !== null) {
        // Skip tags inside quoted attribute values (e.g., value="<b>Title</b>")
        if (isInsideQuotes(fixed, tagCountMatch.index)) continue

        const fullMatch = tagCountMatch[0] // e.g., "<mxCell .../>" or "</mxCell>"
        const tagPart = tagCountMatch[1] // e.g., "mxCell" or "/mxCell"
        const isClosing = tagPart.startsWith("/")
        const isSelfClosing = fullMatch.endsWith("/>")
        const tagName = isClosing ? tagPart.slice(1) : tagPart

        // Only count valid draw.io tags - skip partial/invalid tags like "mx" from streaming
        if (!validDrawioTags.has(tagName)) continue

        let counts = tagCounts.get(tagName)
        if (!counts) {
            counts = { opens: 0, closes: 0, selfClosing: 0 }
            tagCounts.set(tagName, counts)
        }
        if (isClosing) {
            counts.closes++
        } else if (isSelfClosing) {
            counts.selfClosing++
        } else {
            counts.opens++
        }
    }

    // Log tag counts for debugging
    for (const [tagName, counts] of tagCounts) {
        if (
            tagName === "mxCell" ||
            tagName === "mxGeometry" ||
            counts.opens !== counts.closes
        ) {
            console.log(
                `[autoFixXml] Step 10b: ${tagName} - opens: ${counts.opens}, closes: ${counts.closes}, selfClosing: ${counts.selfClosing}`,
            )
        }
    }

    // Find tags with extra closing tags (self-closing tags are balanced, don't need closing)
    for (const [tagName, counts] of tagCounts) {
        const extraCloses = counts.closes - counts.opens // Only compare opens vs closes (self-closing are balanced)
        if (extraCloses > 0) {
            console.log(
                `[autoFixXml] Step 10b: ${tagName} has ${counts.opens} opens, ${counts.closes} closes, removing ${extraCloses} extra`,
            )
            // Remove extra closing tags from the end
            let removed = 0
            const closeTagPattern = new RegExp(`</${tagName}>`, "g")
            const matches = [...fixed.matchAll(closeTagPattern)]
            // Remove from the end (last occurrences are likely the extras)
            for (
                let i = matches.length - 1;
                i >= 0 && removed < extraCloses;
                i--
            ) {
                const match = matches[i]
                const idx = match.index ?? 0
                fixed = fixed.slice(0, idx) + fixed.slice(idx + match[0].length)
                removed++
            }
            if (removed > 0) {
                console.log(
                    `[autoFixXml] Step 10b: Removed ${removed} extra </${tagName}>`,
                )
                fixes.push(
                    `Removed ${removed} extra </${tagName}> closing tag(s)`,
                )
            }
        }
    }

    // 10c. Remove trailing garbage after last XML tag (e.g., stray backslashes, text)
    // Find the last valid closing tag or self-closing tag
    const closingTagPattern = /<\/[a-zA-Z][a-zA-Z0-9]*>|\/>/g
    let lastValidTagEnd = -1
    let closingMatch
    while ((closingMatch = closingTagPattern.exec(fixed)) !== null) {
        lastValidTagEnd = closingMatch.index + closingMatch[0].length
    }
    if (lastValidTagEnd > 0 && lastValidTagEnd < fixed.length) {
        const trailing = fixed.slice(lastValidTagEnd).trim()
        if (trailing) {
            fixed = fixed.slice(0, lastValidTagEnd)
            fixes.push("Removed trailing garbage after last XML tag")
        }
    }

    // 11. Fix nested mxCell by flattening
    // Pattern A: <mxCell id="X">...<mxCell id="X">...</mxCell></mxCell> (duplicate ID)
    // Pattern B: <mxCell id="X">...<mxCell id="Y">...</mxCell></mxCell> (different ID - true nesting)
    const lines = fixed.split("\n")
    let newLines: string[] = []
    let nestedFixed = 0
    let extraClosingToRemove = 0

    // First pass: fix duplicate ID nesting (same as before)
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i]
        const nextLine = lines[i + 1]

        // Check if current line and next line are both mxCell opening tags with same ID
        if (
            nextLine &&
            /<mxCell\s/.test(line) &&
            /<mxCell\s/.test(nextLine) &&
            !line.includes("/>") &&
            !nextLine.includes("/>")
        ) {
            const id1 = line.match(/\bid\s*=\s*["']([^"']+)["']/)?.[1]
            const id2 = nextLine.match(/\bid\s*=\s*["']([^"']+)["']/)?.[1]

            if (id1 && id1 === id2) {
                nestedFixed++
                extraClosingToRemove++ // Need to remove one </mxCell> later
                continue // Skip this duplicate opening line
            }
        }

        // Remove extra </mxCell> if we have pending removals
        if (extraClosingToRemove > 0 && /^\s*<\/mxCell>\s*$/.test(line)) {
            extraClosingToRemove--
            continue // Skip this closing tag
        }

        newLines.push(line)
    }

    if (nestedFixed > 0) {
        fixed = newLines.join("\n")
        fixes.push(`Flattened ${nestedFixed} duplicate-ID nested mxCell(s)`)
    }

    // Second pass: fix true nesting (different IDs)
    // Insert </mxCell> before nested child to close parent
    const lines2 = fixed.split("\n")
    newLines = []
    let trueNestedFixed = 0
    let cellDepth = 0
    let pendingCloseRemoval = 0

    for (let i = 0; i < lines2.length; i++) {
        const line = lines2[i]
        const trimmed = line.trim()

        // Track mxCell depth
        const isOpenCell = /<mxCell\s/.test(trimmed) && !trimmed.endsWith("/>")
        const isCloseCell = trimmed === "</mxCell>"

        if (isOpenCell) {
            if (cellDepth > 0) {
                // Found nested cell - insert closing tag for parent before this line
                const indent = line.match(/^(\s*)/)?.[1] || ""
                newLines.push(indent + "</mxCell>")
                trueNestedFixed++
                pendingCloseRemoval++ // Need to remove one </mxCell> later
            }
            cellDepth = 1 // Reset to 1 since we just opened a new cell
            newLines.push(line)
        } else if (isCloseCell) {
            if (pendingCloseRemoval > 0) {
                pendingCloseRemoval--
                // Skip this extra closing tag
            } else {
                cellDepth = Math.max(0, cellDepth - 1)
                newLines.push(line)
            }
        } else {
            newLines.push(line)
        }
    }

    if (trueNestedFixed > 0) {
        fixed = newLines.join("\n")
        fixes.push(`Fixed ${trueNestedFixed} true nested mxCell(s)`)
    }

    // 12. Fix duplicate IDs by appending suffix
    const seenIds = new Map<string, number>()
    const duplicateIds: string[] = []

    // First pass: find duplicates
    const idPattern = /\bid\s*=\s*["']([^"']+)["']/gi
    let idMatch
    while ((idMatch = idPattern.exec(fixed)) !== null) {
        const id = idMatch[1]
        seenIds.set(id, (seenIds.get(id) || 0) + 1)
    }

    // Find which IDs are duplicated
    for (const [id, count] of seenIds) {
        if (count > 1) duplicateIds.push(id)
    }

    // Second pass: rename duplicates (keep first occurrence, rename others)
    if (duplicateIds.length > 0) {
        const idCounters = new Map<string, number>()
        fixed = fixed.replace(/\bid\s*=\s*["']([^"']+)["']/gi, (match, id) => {
            if (!duplicateIds.includes(id)) return match

            const count = idCounters.get(id) || 0
            idCounters.set(id, count + 1)

            if (count === 0) return match // Keep first occurrence

            // Rename subsequent occurrences
            const newId = `${id}_dup${count}`
            return match.replace(id, newId)
        })
        fixes.push(`Renamed ${duplicateIds.length} duplicate ID(s)`)
    }

    // 9. Fix empty id attributes by generating unique IDs
    let emptyIdCount = 0
    fixed = fixed.replace(
        /<mxCell([^>]*)\sid\s*=\s*["']\s*["']([^>]*)>/g,
        (_match, before, after) => {
            emptyIdCount++
            const newId = `cell_${Date.now()}_${emptyIdCount}`
            return `<mxCell${before} id="${newId}"${after}>`
        },
    )
    if (emptyIdCount > 0) {
        fixes.push(`Generated ${emptyIdCount} missing ID(s)`)
    }

    // 13. Aggressive: drop broken mxCell elements that can't be fixed
    // Only do this if DOM parser still finds errors after all other fixes
    if (typeof DOMParser !== "undefined") {
        let droppedCells = 0
        let maxIterations = MAX_DROP_ITERATIONS
        while (maxIterations-- > 0) {
            const parser = new DOMParser()
            const doc = parser.parseFromString(fixed, "text/xml")
            const parseError = doc.querySelector("parsererror")
            if (!parseError) break // Valid now!

            const errText = parseError.textContent || ""
            const match = errText.match(/(\d+):\d+:/)
            if (!match) break

            const errLine = parseInt(match[1], 10) - 1
            const lines = fixed.split("\n")

            // Find the mxCell containing this error line
            let cellStart = errLine
            let cellEnd = errLine

            // Go back to find <mxCell
            while (cellStart > 0 && !lines[cellStart].includes("<mxCell")) {
                cellStart--
            }

            // Go forward to find </mxCell> or />
            while (cellEnd < lines.length - 1) {
                if (
                    lines[cellEnd].includes("</mxCell>") ||
                    lines[cellEnd].trim().endsWith("/>")
                ) {
                    break
                }
                cellEnd++
            }

            // Remove these lines
            lines.splice(cellStart, cellEnd - cellStart + 1)
            fixed = lines.join("\n")
            droppedCells++
        }
        if (droppedCells > 0) {
            fixes.push(`Dropped ${droppedCells} unfixable mxCell element(s)`)
        }
    }

    return { fixed, fixes }
}

/**
 * Validates XML and attempts to fix if invalid
 * @param xml - The XML string to validate and potentially fix
 * @returns Object with validation result, fixed XML if applicable, and fixes applied
 */
export function validateAndFixXml(xml: string): {
    valid: boolean
    error: string | null
    fixed: string | null
    fixes: string[]
} {
    // First validation attempt
    let error = validateMxCellStructure(xml)

    if (!error) {
        return { valid: true, error: null, fixed: null, fixes: [] }
    }

    // Try to fix
    const { fixed, fixes } = autoFixXml(xml)
    console.log("[validateAndFixXml] Fixes applied:", fixes)

    // Validate the fixed version
    error = validateMxCellStructure(fixed)
    if (error) {
        console.log("[validateAndFixXml] Still invalid after fix:", error)
    }

    if (!error) {
        return { valid: true, error: null, fixed, fixes }
    }

    // Still invalid after fixes - but return the partially fixed XML
    // so we can see what was fixed and what error remains
    return {
        valid: false,
        error,
        fixed: fixes.length > 0 ? fixed : null,
        fixes,
    }
}

export function extractDiagramXML(xml_svg_string: string): string {
    try {
        // 1. Parse the SVG string (using built-in DOMParser in a browser-like environment)
        const svgString = atob(xml_svg_string.slice(26))
        const parser = new DOMParser()
        const svgDoc = parser.parseFromString(svgString, "image/svg+xml")
        const svgElement = svgDoc.querySelector("svg")

        if (!svgElement) {
            throw new Error("No SVG element found in the input string.")
        }
        // 2. Extract the 'content' attribute
        const encodedContent = svgElement.getAttribute("content")

        if (!encodedContent) {
            throw new Error("SVG element does not have a 'content' attribute.")
        }

        // 3. Decode HTML entities (using a minimal function)
        function decodeHtmlEntities(str: string) {
            const textarea = document.createElement("textarea") // Use built-in element
            textarea.innerHTML = str
            return textarea.value
        }
        const xmlContent = decodeHtmlEntities(encodedContent)

        // 4. Parse the XML content
        const xmlDoc = parser.parseFromString(xmlContent, "text/xml")
        const diagramElement = xmlDoc.querySelector("diagram")

        if (!diagramElement) {
            throw new Error("No diagram element found")
        }
        // 5. Extract base64 encoded data
        const base64EncodedData = diagramElement.textContent

        if (!base64EncodedData) {
            throw new Error("No encoded data found in the diagram element")
        }

        // 6. Decode base64 data
        const binaryString = atob(base64EncodedData)

        // 7. Convert binary string to Uint8Array
        const len = binaryString.length
        const bytes = new Uint8Array(len)
        for (let i = 0; i < len; i++) {
            bytes[i] = binaryString.charCodeAt(i)
        }

        // 8. Decompress data using pako (equivalent to zlib.decompress with wbits=-15)
        const decompressedData = pako.inflate(bytes, { windowBits: -15 })

        // 9. Convert the decompressed data to a string
        const decoder = new TextDecoder("utf-8")
        const decodedString = decoder.decode(decompressedData)

        // Decode URL-encoded content (equivalent to Python's urllib.parse.unquote)
        const urlDecodedString = decodeURIComponent(decodedString)

        return urlDecodedString
    } catch (error) {
        console.error("Error extracting diagram XML:", error)
        throw error // Re-throw for caller handling
    }
}
