import type { MutableRefObject } from "react"
import { useRef } from "react"
import type { DiagramOperation } from "@/components/chat/types"
import type {
    ValidationState,
    ValidationStatus,
} from "@/components/chat/ValidationCard"
import type { ValidationResult } from "@/lib/diagram-validator"
import { formatValidationFeedback } from "@/lib/diagram-validator"
import {
    applyAutoLayout,
    isMxCellXmlComplete,
    wrapWithMxFile,
} from "@/lib/utils"

/**
 * Detect if XML content appears truncated even when structurally complete.
 * This catches cases where the model stopped mid-generation at a valid boundary.
 *
 * Heuristics:
 * 1. XML ends right after </mxCell> or /> with no closing wrapper tags
 * 2. The last cell is a leaf node (not a container) but the diagram seems large
 *    (e.g., 50+ cells) and the last cell has no following content
 */
function isLikelyContentTruncated(xml: string): boolean {
    const trimmed = xml.trimEnd()
    if (!trimmed) return false

    // Check if ends right after a cell tag (suggesting more cells were coming)
    const endsAfterCell =
        trimmed.endsWith("</mxCell>") || trimmed.endsWith("/>")

    if (!endsAfterCell) return false

    // Count cells to see if this is a large diagram that might be incomplete
    const cellCount = (xml.match(/<mxCell\s/g) || []).length
    if (cellCount < 10) return false // Small diagrams are likely complete

    // Check if there are any closing wrapper tags after the last cell
    // Extract content after the last </mxCell> or />
    const lastCellEnd = Math.max(
        trimmed.lastIndexOf("</mxCell>"),
        trimmed.lastIndexOf("/>"),
    )
    const afterLastCell = trimmed.slice(lastCellEnd + 9).trim()

    // If there's nothing after the last cell (or just whitespace), it's suspicious
    // for a large diagram - the model likely stopped mid-generation
    if (afterLastCell === "" && cellCount >= 20) {
        return true
    }

    return false
}

const DEBUG = process.env.NODE_ENV === "development"

interface ToolCall {
    toolCallId: string
    toolName: string
    input: unknown
}

type AddToolOutputSuccess = {
    tool: string
    toolCallId: string
    state?: "output-available"
    output: string
    errorText?: undefined
}

type AddToolOutputError = {
    tool: string
    toolCallId: string
    state: "output-error"
    output?: undefined
    errorText: string
}

type AddToolOutputParams = AddToolOutputSuccess | AddToolOutputError

type AddToolOutputFn = (params: AddToolOutputParams) => void

const MAX_VALIDATION_RETRIES = 3

// Type for the validation function passed from useValidateDiagram hook
type ValidateDiagramFn = (
    imageData: string,
    sessionId?: string,
) => Promise<ValidationResult>

interface UseDiagramToolHandlersParams {
    partialXmlRef: MutableRefObject<string>
    editDiagramOriginalXmlRef: MutableRefObject<Map<string, string>>
    chartXMLRef: MutableRefObject<string>
    onDisplayChart: (xml: string, skipValidation?: boolean) => string | null
    onFetchChart: (saveToHistory?: boolean) => Promise<string>
    onExport: () => void
    captureValidationPng?: () => Promise<string | null>
    validateDiagram?: ValidateDiagramFn
    enableVlmValidation?: boolean
    sessionId?: string
    onValidationStateChange?: (
        toolCallId: string,
        state: ValidationState,
    ) => void
}

/**
 * Hook that creates the onToolCall handler for diagram-related tools.
 * Handles display_diagram, edit_diagram, and append_diagram tools.
 *
 * Note: addToolOutput is passed at call time (not hook init) because
 * it comes from useChat which creates a circular dependency.
 */
export function useDiagramToolHandlers({
    partialXmlRef,
    editDiagramOriginalXmlRef,
    chartXMLRef,
    onDisplayChart,
    onFetchChart,
    onExport,
    captureValidationPng,
    validateDiagram,
    enableVlmValidation = true,
    sessionId,
    onValidationStateChange,
}: UseDiagramToolHandlersParams) {
    // Track validation retry count per tool call
    const validationRetryCountRef = useRef<Map<string, number>>(new Map())

    // Helper to update validation state
    const updateValidationState = (
        toolCallId: string,
        status: ValidationStatus,
        options?: {
            attempt?: number
            maxAttempts?: number
            result?: ValidationResult
            error?: string
            imageData?: string
        },
    ) => {
        if (onValidationStateChange) {
            onValidationStateChange(toolCallId, {
                status,
                ...options,
            })
        }
    }
    const handleToolCall = async (
        { toolCall }: { toolCall: ToolCall },
        addToolOutput: AddToolOutputFn,
    ) => {
        if (DEBUG) {
            console.log(
                `[onToolCall] Tool: ${toolCall.toolName}, CallId: ${toolCall.toolCallId}`,
            )
        }

        if (toolCall.toolName === "display_diagram") {
            await handleDisplayDiagram(toolCall, addToolOutput)
        } else if (toolCall.toolName === "edit_diagram") {
            await handleEditDiagram(toolCall, addToolOutput)
        } else if (toolCall.toolName === "append_diagram") {
            handleAppendDiagram(toolCall, addToolOutput)
        }
    }

    const handleDisplayDiagram = async (
        toolCall: ToolCall,
        addToolOutput: AddToolOutputFn,
    ) => {
        const input = toolCall.input as { xml: string; _truncated?: boolean }
        const { xml } = input
        const serverFlaggedTruncated = input._truncated === true

        // DEBUG: Log raw input to diagnose false truncation detection
        if (DEBUG) {
            console.log(
                "[display_diagram] XML ending (last 100 chars):",
                xml.slice(-100),
            )
            console.log("[display_diagram] XML length:", xml.length)
            console.log(
                "[display_diagram] serverFlaggedTruncated:",
                serverFlaggedTruncated,
            )
        }

        // Check if XML is structurally truncated (incomplete mxCell)
        const isStructurallyTruncated = !isMxCellXmlComplete(xml)

        // Check if content appears truncated even though structurally complete
        // (model stopped at a valid boundary but had more to generate)
        const likelyContentTruncated = isLikelyContentTruncated(xml)
        const isTruncated = isStructurallyTruncated || likelyContentTruncated

        if (DEBUG) {
            console.log(
                "[display_diagram] isStructurallyTruncated:",
                isStructurallyTruncated,
            )
            console.log(
                "[display_diagram] likelyContentTruncated:",
                likelyContentTruncated,
            )
        }

        if (isTruncated) {
            // Store the partial XML for continuation via append_diagram
            partialXmlRef.current = xml

            // Count cells already generated so the model knows how far along it is
            const cellCount = (xml.match(/<mxCell\s/g) || []).length

            // CRITICAL: Do NOT show any XML snippet. Showing the truncated XML
            // tempts the model to "fix" the whole diagram from scratch, causing
            // infinite regenerate→truncate loops. Just tell it to append.
            addToolOutput({
                tool: "display_diagram",
                toolCallId: toolCall.toolCallId,
                state: "output-error",
                errorText: `Your output was truncated due to length limits. You generated ${cellCount} cells so far, but the diagram is not yet complete.

⚠️ CRITICAL: DO NOT regenerate the entire diagram from scratch.
DO NOT call display_diagram again with all cells.

NEXT STEP: Call append_diagram to add ONLY the remaining cells that were NOT yet generated.
- Just output the missing <mxCell> elements
- Start IDs from where you left off (next ID after id="${cellCount}")
- Do NOT include wrapper tags or root cells`,
            })
            return
        }

        // XML is structurally complete - display it
        const finalXml = xml
        partialXmlRef.current = "" // Reset any partial from previous truncation

        // Wrap raw XML with full mxfile structure for draw.io
        let fullXml = wrapWithMxFile(finalXml)

        // Apply auto-layout to reduce cell overlaps before display
        fullXml = applyAutoLayout(fullXml)

        // loadDiagram validates and returns error if invalid
        const validationError = onDisplayChart(fullXml)

        if (validationError) {
            console.warn("[display_diagram] Validation error:", validationError)
            if (DEBUG) {
                console.log(
                    "[display_diagram] Adding tool output with state: output-error",
                )
            }
            addToolOutput({
                tool: "display_diagram",
                toolCallId: toolCall.toolCallId,
                state: "output-error",
                errorText: `${validationError}

Please fix the XML issues and call display_diagram again with corrected XML.

⚠️ IMPORTANT: Only fix the specific issue mentioned above. Do NOT change the diagram structure or regenerate from scratch.`,
            })
        } else {
            // Diagram displayed successfully
            if (serverFlaggedTruncated) {
                // Server detected that jsonrepair discarded data during truncation repair.
                // The diagram is displayed, but some cells are missing.
                // Tell the model to continue with append_diagram.
                console.warn(
                    "[display_diagram] Server flagged truncation - diagram displayed but some cells were dropped.",
                )

                const cellCount = (xml.match(/<mxCell\s/g) || []).length

                // CRITICAL: Do NOT show any XML snippet. Showing the truncated XML
                // tempts the model to "fix" the whole diagram from scratch, causing
                // infinite regenerate→truncate loops.
                addToolOutput({
                    tool: "display_diagram",
                    toolCallId: toolCall.toolCallId,
                    state: "output-error",
                    errorText: `The diagram was displayed (${cellCount} cells), but your output was truncated and some cells were silently dropped.

⚠️ CRITICAL: DO NOT regenerate the entire diagram from scratch.
DO NOT call display_diagram again with all cells.

NEXT STEP: Call append_diagram to add ONLY the missing cells.
- Just output the remaining <mxCell> elements that weren't included
- Start IDs from where you left off
- Do NOT include wrapper tags or root cells`,
                })
                return
            }

            // VLM validation after successful display
            if (
                enableVlmValidation &&
                captureValidationPng &&
                validateDiagram
            ) {
                let capturedPngData: string | null = null
                try {
                    // Notify UI that we're starting capture
                    updateValidationState(toolCall.toolCallId, "capturing")

                    // Small delay (100ms) to allow diagram rendering to complete before capture.
                    // This is a best-effort heuristic and may need adjustment for complex diagrams or slower devices.
                    await new Promise((resolve) => setTimeout(resolve, 100))

                    capturedPngData = await captureValidationPng()
                    if (capturedPngData) {
                        if (DEBUG) {
                            console.log(
                                "[display_diagram] Captured PNG for validation",
                            )
                        }

                        const retryCount =
                            validationRetryCountRef.current.get(
                                toolCall.toolCallId,
                            ) || 0

                        // Notify UI that we're validating (include the image)
                        updateValidationState(
                            toolCall.toolCallId,
                            "validating",
                            {
                                attempt: retryCount + 1,
                                maxAttempts: MAX_VALIDATION_RETRIES,
                                imageData: capturedPngData,
                            },
                        )

                        const result = await validateDiagram(
                            capturedPngData,
                            sessionId,
                        )

                        if (!result.valid) {
                            if (retryCount < MAX_VALIDATION_RETRIES) {
                                validationRetryCountRef.current.set(
                                    toolCall.toolCallId,
                                    retryCount + 1,
                                )

                                const feedback =
                                    formatValidationFeedback(result)
                                if (DEBUG) {
                                    console.log(
                                        `[display_diagram] Validation failed (attempt ${retryCount + 1}/${MAX_VALIDATION_RETRIES}):`,
                                        result.issues,
                                    )
                                }

                                // Notify UI of validation failure (include the image)
                                updateValidationState(
                                    toolCall.toolCallId,
                                    "failed",
                                    {
                                        attempt: retryCount + 1,
                                        maxAttempts: MAX_VALIDATION_RETRIES,
                                        result,
                                        imageData: capturedPngData,
                                    },
                                )

                                addToolOutput({
                                    tool: "display_diagram",
                                    toolCallId: toolCall.toolCallId,
                                    state: "output-error",
                                    errorText: `[Validation attempt ${retryCount + 1}/${MAX_VALIDATION_RETRIES}]\n${feedback}`,
                                })
                                return
                            } else {
                                // Max retries reached - accept the diagram with warning
                                if (DEBUG) {
                                    console.log(
                                        "[display_diagram] Max validation retries reached, accepting diagram",
                                    )
                                }
                                validationRetryCountRef.current.delete(
                                    toolCall.toolCallId,
                                )

                                // Notify UI that we're accepting with issues (include the image)
                                updateValidationState(
                                    toolCall.toolCallId,
                                    "skipped",
                                    { result, imageData: capturedPngData },
                                )

                                addToolOutput({
                                    tool: "display_diagram",
                                    toolCallId: toolCall.toolCallId,
                                    output: "Diagram displayed (validation issues noted but max retries reached).",
                                })
                                return
                            }
                        } else {
                            // Validation passed - clean up retry count
                            validationRetryCountRef.current.delete(
                                toolCall.toolCallId,
                            )
                            if (DEBUG) {
                                console.log(
                                    "[display_diagram] Validation passed!",
                                )
                            }

                            // Notify UI of success (include the image)
                            // Use "success_with_warnings" if valid but has issues
                            const hasWarnings = result.issues.length > 0
                            updateValidationState(
                                toolCall.toolCallId,
                                hasWarnings
                                    ? "success_with_warnings"
                                    : "success",
                                { result, imageData: capturedPngData },
                            )
                        }
                    } else {
                        // PNG capture failed - skip validation
                        updateValidationState(toolCall.toolCallId, "skipped")
                    }
                } catch (error) {
                    // VLM validation error - log but don't block the user
                    console.warn(
                        "[display_diagram] VLM validation error:",
                        error,
                    )
                    updateValidationState(toolCall.toolCallId, "error", {
                        error:
                            error instanceof Error
                                ? error.message
                                : "Validation failed",
                        imageData: capturedPngData || undefined,
                    })
                }
            }

            if (DEBUG) {
                console.log(
                    "[display_diagram] Adding tool output with state: output-available",
                )
            }

            // Debug: include diagram stats in response so user can verify completeness
            const cellCount = (xml.match(/<mxCell\s/g) || []).length
            const xmlLen = xml.length
            addToolOutput({
                tool: "display_diagram",
                toolCallId: toolCall.toolCallId,
                output: `Successfully displayed the diagram. (${cellCount} cells, ${xmlLen.toLocaleString()} chars)`,
            })
            if (DEBUG) {
                console.log(
                    "[display_diagram] Tool output added. Diagram should be visible now.",
                )
            }
        }
    }

    const handleEditDiagram = async (
        toolCall: ToolCall,
        addToolOutput: AddToolOutputFn,
    ) => {
        const input = toolCall.input as {
            operations: DiagramOperation[]
            _truncated?: boolean
        }
        const { operations, _truncated } = input

        // Server detected that edit_diagram input was truncated.
        // The operations array is incomplete - some operations were dropped.
        if (_truncated) {
            const opCount = operations.length
            addToolOutput({
                tool: "edit_diagram",
                toolCallId: toolCall.toolCallId,
                state: "output-error",
                errorText: `Received ${opCount} operations, but your edit_diagram input was truncated - some operations were silently dropped.

⚠️ CRITICAL: DO NOT regenerate the entire diagram.
DO NOT call display_diagram.

NEXT STEP: Call edit_diagram again with the remaining operations that were NOT included in this batch.
- Only include the operations that were dropped
- Use the same operation format (add/update/delete)`,
            })
            editDiagramOriginalXmlRef.current.delete(toolCall.toolCallId)
            return
        }

        let currentXml = ""
        try {
            // Use the original XML captured during streaming (shared with chat-message-display)
            // This ensures we apply operations to the same base XML that streaming used
            const originalXml = editDiagramOriginalXmlRef.current.get(
                toolCall.toolCallId,
            )
            if (originalXml) {
                currentXml = originalXml
            } else {
                // Fallback: use chartXML from ref if streaming didn't capture original
                const cachedXML = chartXMLRef.current
                if (cachedXML) {
                    currentXml = cachedXML
                } else {
                    // Last resort: export from iframe
                    currentXml = await onFetchChart(false)
                }
            }

            const { applyDiagramOperations } = await import("@/lib/utils")
            const { result: editedXml, errors } = applyDiagramOperations(
                currentXml,
                operations,
            )

            // Check for operation errors
            if (errors.length > 0) {
                const errorMessages = errors
                    .map(
                        (e) =>
                            `- ${e.type} on cell_id="${e.cellId}": ${e.message}`,
                    )
                    .join("\n")

                addToolOutput({
                    tool: "edit_diagram",
                    toolCallId: toolCall.toolCallId,
                    state: "output-error",
                    errorText: `Some operations failed:\n${errorMessages}

Please check the cell IDs and retry. Do NOT regenerate the entire diagram.`,
                })
                // Clean up the shared original XML ref
                editDiagramOriginalXmlRef.current.delete(toolCall.toolCallId)
                return
            }

            // loadDiagram validates and returns error if invalid
            const validationError = onDisplayChart(editedXml)
            if (validationError) {
                console.warn(
                    "[edit_diagram] Validation error:",
                    validationError,
                )
                addToolOutput({
                    tool: "edit_diagram",
                    toolCallId: toolCall.toolCallId,
                    state: "output-error",
                    errorText: `Edit produced invalid XML: ${validationError}

Please fix the operations to avoid structural issues. Do NOT regenerate the entire diagram.`,
                })
                // Clean up the shared original XML ref
                editDiagramOriginalXmlRef.current.delete(toolCall.toolCallId)
                return
            }
            onExport()
            const cellCount = (editedXml.match(/<mxCell\s/g) || []).length
            addToolOutput({
                tool: "edit_diagram",
                toolCallId: toolCall.toolCallId,
                output: `Successfully applied ${operations.length} operation(s). Diagram now has ${cellCount} cells.

Diagram is displayed with your changes. No further action needed.`,
            })
            // Clean up the shared original XML ref
            editDiagramOriginalXmlRef.current.delete(toolCall.toolCallId)
        } catch (error) {
            console.error("[edit_diagram] Failed:", error)

            const errorMessage =
                error instanceof Error ? error.message : String(error)

            addToolOutput({
                tool: "edit_diagram",
                toolCallId: toolCall.toolCallId,
                state: "output-error",
                errorText: `Edit failed: ${errorMessage}

Please check cell IDs and retry. Do NOT regenerate the entire diagram.`,
            })
            // Clean up the shared original XML ref even on error
            editDiagramOriginalXmlRef.current.delete(toolCall.toolCallId)
        }
    }

    const handleAppendDiagram = (
        toolCall: ToolCall,
        addToolOutput: AddToolOutputFn,
    ) => {
        const input = toolCall.input as { xml: string; _truncated?: boolean }
        const { xml, _truncated } = input

        // Server detected that this append_diagram output was also truncated.
        // Even if XML structure looks complete, the model likely had more cells to generate.
        if (_truncated) {
            // Still append what we got so far
            partialXmlRef.current += xml

            const cellCount = (partialXmlRef.current.match(/<mxCell\s/g) || [])
                .length
            addToolOutput({
                tool: "append_diagram",
                toolCallId: toolCall.toolCallId,
                state: "output-error",
                errorText: `Received ${cellCount} cells so far, but your append_diagram output was truncated again.

⚠️ CRITICAL: DO NOT regenerate the entire diagram from scratch.
DO NOT call display_diagram.

NEXT STEP: Call append_diagram again to add the remaining cells.
- Continue from exactly where you stopped
- Just output the remaining <mxCell> elements
- Do NOT include wrapper tags`,
            })
            return
        }

        // Detect if LLM incorrectly started fresh instead of continuing
        // LLM should only output bare mxCells now, so wrapper tags indicate error
        const trimmed = xml.trim()
        const isFreshStart =
            trimmed.startsWith("<mxGraphModel") ||
            trimmed.startsWith("<root") ||
            trimmed.startsWith("<mxfile") ||
            trimmed.startsWith('<mxCell id="0"') ||
            trimmed.startsWith('<mxCell id="1"')

        if (isFreshStart) {
            addToolOutput({
                tool: "append_diagram",
                toolCallId: toolCall.toolCallId,
                state: "output-error",
                errorText: `ERROR: You included wrapper tags (mxGraphModel, root, mxCell id="0"/"1").

DO NOT regenerate the diagram. DO NOT include wrapper tags.

Just output the remaining <mxCell> elements that haven't been generated yet.`,
            })
            return
        }

        // Append to accumulated XML
        partialXmlRef.current += xml

        // Check if XML is now complete (last mxCell is complete)
        const isComplete = isMxCellXmlComplete(partialXmlRef.current)

        if (isComplete) {
            // Wrap and display the complete diagram
            const finalXml = partialXmlRef.current
            partialXmlRef.current = "" // Reset

            let fullXml = wrapWithMxFile(finalXml)

            // Apply auto-layout to reduce cell overlaps before display
            fullXml = applyAutoLayout(fullXml)

            const validationError = onDisplayChart(fullXml)

            if (validationError) {
                // Validation error after assembly - the combined XML has issues.
                // The diagram is still displayed (onDisplayChart was called above).
                // Use output-available (not error) to prevent the model from trying to "fix" it.
                const cellCount = (finalXml.match(/<mxCell\s/g) || []).length
                addToolOutput({
                    tool: "append_diagram",
                    toolCallId: toolCall.toolCallId,
                    output: `Diagram displayed with ${cellCount} cells. Validation warning: ${validationError}. No further action needed.`,
                })
            } else {
                const cellCount = (finalXml.match(/<mxCell\s/g) || []).length
                addToolOutput({
                    tool: "append_diagram",
                    toolCallId: toolCall.toolCallId,
                    output: `Diagram assembly complete. Displayed ${cellCount} cells. No further action needed.`,
                })
            }
        } else {
            // Still incomplete - signal to continue
            addToolOutput({
                tool: "append_diagram",
                toolCallId: toolCall.toolCallId,
                state: "output-error",
                errorText: `XML still incomplete (mxCell not closed). Call append_diagram again to continue adding the remaining cells.

Do NOT regenerate. Just continue from where you stopped.`,
            })
        }
    }

    return { handleToolCall }
}
