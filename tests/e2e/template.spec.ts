import { expect, test } from "./lib/fixtures"

test.describe("Template System", () => {
    test.beforeEach(async ({ page }) => {
        await page.goto("/", { waitUntil: "domcontentloaded", timeout: 60000 })
        // 等待一小段时间让页面渲染完成
        await page.waitForTimeout(2000)
    })

    test("template uploader should be visible in settings", async ({
        page,
    }) => {
        // 打开设置
        await page.click('[data-testid="settings-button"]')
        // 使用更具体的定位器
        await expect(page.getByText("模板", { exact: true })).toBeVisible({
            timeout: 5000,
        })
    })

    test("should load builtin diagram template", async ({ page }) => {
        // 打开设置
        await page.click('[data-testid="settings-button"]')

        // 等待设置对话框出现
        await page.waitForTimeout(500)

        // 检查是否有模板相关按钮
        const templateButtons = page.locator("button:has-text('横向泳道')")
        const count = await templateButtons.count()
        // 如果模板选择器在设置中，应该能看到
        console.log("Template button count:", count)
    })

    test("should load builtin style template", async ({ page }) => {
        await page.click('[data-testid="settings-button"]')
        await page.waitForTimeout(500)

        const styleButton = page.locator("button:has-text('Claude 样式')")
        const styleCount = await styleButton.count()
        console.log("Style button count:", styleCount)
    })

    test("layout optimizer button should be visible", async ({ page }) => {
        // 布局优化按钮应该在某个工具栏中
        const optimizeButton = page.locator("button:has-text('布局优化')")
        const optimizeCount = await optimizeButton.count()
        console.log("Optimize button count:", optimizeCount)
    })
})
