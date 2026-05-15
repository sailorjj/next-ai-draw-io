"use client"

import { CheckCircle, Loader2, Sparkles } from "lucide-react"
import { useCallback, useState } from "react"
import { cn } from "@/lib/utils"

interface LayoutOptimizerButtonProps {
    onOptimize: () => Promise<string>
    className?: string
}

export function LayoutOptimizerButton({
    onOptimize,
    className,
}: LayoutOptimizerButtonProps) {
    const [status, setStatus] = useState<"idle" | "optimizing" | "done">("idle")

    const handleClick = useCallback(async () => {
        if (status !== "idle") return

        setStatus("optimizing")
        try {
            await onOptimize()
            setStatus("done")
            setTimeout(() => setStatus("idle"), 2000)
        } catch (error) {
            console.error("Optimization failed:", error)
            setStatus("idle")
        }
    }, [onOptimize, status])

    return (
        <button
            type="button"
            onClick={handleClick}
            disabled={status !== "idle"}
            className={cn(
                "flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-all",
                "bg-gradient-to-r from-purple-500 to-pink-500 text-white",
                "hover:from-purple-600 hover:to-pink-600",
                "disabled:opacity-50 disabled:cursor-not-allowed",
                "shadow-sm hover:shadow-md",
                className,
            )}
        >
            {status === "optimizing" && (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
            )}
            {status === "done" && <CheckCircle className="w-3.5 h-3.5" />}
            {status === "idle" && <Sparkles className="w-3.5 h-3.5" />}
            {status === "optimizing" && "优化中..."}
            {status === "done" && "已优化"}
            {status === "idle" && "布局优化"}
        </button>
    )
}
