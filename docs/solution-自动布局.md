# 图表自动布局（整形）功能 - Solution

## 概述

在图表生成完成后，用户可点击「整形」按钮，系统自动重新排列图表内所有 cell 的几何位置，减少碰撞、整齐排列。

## 核心设计原则

1. **手动触发**：整形不是自动的，是用户在聊天界面点击按钮后才执行
2. **只改几何**：仅修改 mxGeometry 的 x/y/width/height，保留所有其他属性（style、value、id、edge source/target）
3. **保持 cell 原始尺寸**：不改变 cell 的 width/height，只改 x/y 位置
4. **容器自动缩放**：容器（swimlane 等）的 width/height 根据子节点自动调整
5. **子节点对齐**：容器内的子节点按网格排列，水平或垂直对齐
6. **draw.io 关键特性**：子节点坐标是相对于父容器的

## 算法概述

```
applyAutoLayout(xml):
  1. 解析 XML → 提取所有 mxCell 及其几何信息
  2. 构建 parent → children 映射
  3. 识别容器（有 ≥2 个子节点 vertex 的 cell，或 style 含 startSize 的 swimlane）
  4. 自底向上遍历容器树：
     a. 递归处理嵌套容器
     b. 子节点按 4 列网格排列，保持原始尺寸
     c. 容器尺寸 = 子节点包围盒 + 内边距(30px)
  5. 顶层元素（parent="1"）按行排列：
     a. 容器先排，从左到右换行
     b. 独立节点排在容器下方，网格排列
  6. 边（edge）不修改 — draw.io 自动路由
```

## 参数

| 参数 | 值 | 说明 |
|------|-----|------|
| LAYOUT_COLS | 4 | 容器内子节点每行最多 4 个 |
| LAYOUT_GAP | 40 | 元素间距 |
| LAYOUT_PADDING | 30 | 容器内边距 |
| LAYOUT_CANVAS_W | 700 | 画布可用宽度 |
| LAYOUT_NODE_W | 120 | 独立节点默认宽 |
| LAYOUT_NODE_H | 60 | 独立节点默认高 |

## 修改文件

| 文件 | 修改内容 |
|------|----------|
| `lib/utils.ts` | 新增 `applyAutoLayout` 函数 |
| `components/chat/FormatButton.tsx` | 新建，「整形」按钮组件 |
| `components/chat/Chat.tsx` | 导入 FormatButton，放在聊天输入区 |
| `hooks/use-diagram-tool-handlers.ts` | 新增 `onFormatDiagram` 回调 |

## 验收标准

1. 图表生成后，聊天界面出现「整形」按钮
2. 点击按钮后，当前图表重新布局
3. 容器内子节点不再碰撞，保持 40px 间距
4. 容器尺寸适配子节点
5. 所有 cell 的 style、value、id、edge 连接保持不变
6. 无容器时按钮可用（独立节点也排列）
7. 空图表时按钮点击无副作用
