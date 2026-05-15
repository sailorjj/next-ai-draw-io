import { render } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { LayoutOptimizerButton } from "@/components/layout-optimizer-button"

describe("LayoutOptimizerButton", () => {
    // 测试 1: 渲染测试
    it("should render", () => {
        const mockOnOptimize = vi.fn().mockResolvedValue("optimized")
        const { container } = render(
            <LayoutOptimizerButton onOptimize={mockOnOptimize} />,
        )

        const button = container.querySelector("button")
        expect(button).not.toBeNull()
        expect(button?.className).toContain("bg-gradient-to-r")
    })

    // 测试 2: 自定义 className
    it("should accept custom className", () => {
        const mockOnOptimize = vi.fn().mockResolvedValue("optimized")
        const { container } = render(
            <LayoutOptimizerButton
                onOptimize={mockOnOptimize}
                className="custom-class"
            />,
        )

        const button = container.querySelector("button")
        expect(button?.className).toContain("custom-class")
    })
})
