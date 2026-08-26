# Seedream-5-pro 接入设计

## 目标

新增启用的 `seedream-5-pro` 图片模型及一条 PixelleLabs OpenAI 图片线路。模型展示名和上游模型名均按需求设置，尺寸仅允许 1K/2K，其他生成与编辑参数沿用 GPT-Image-2。

## 方案

在静态模型目录增加独立模型族，在静态线路目录增加 `openai-image` 同步线路：`https://api.pixellelabs.com/v1/images/generations`，编辑路径为 `/v1/images/edits`，Key 环境变量为 `IMAGE_ROUTE_SEEDREAM_5_PRO_KEY`，线路成本沿用确认的 3 点。前端通过模型的尺寸选项和 GPT 兼容分支生成 `size`、`quality`、`output_format`、`moderation` 等字段；后端将 Seedream 识别为 GPT 图片请求格式，并在 4K 输入时返回 400，避免错误扣点或转发。

同时更新经典版允许模型白名单与 GPT 参数分支，并补充目录和尺寸限制测试。MySQL 运行时会按现有静态目录增量种子逻辑自动补入新模型和线路。

## 验收标准

1. 两个模型目录接口都能看到 `seedream-5-pro`，模型默认/当前尺寸选项为 `1k`,`2k`。
2. 路由目录包含启用的 PixelleLabs 同步线路，生成和编辑 URL 正确，Key 环境变量正确。
3. 画布版和经典版均使用 `seedream-5-pro`，并传递 GPT-Image-2 同款质量、格式、审核和尺寸字段。
4. `4k`、4K 等价尺寸请求在后端被拒绝；1K/2K 请求保持 GPT 尺寸归一化行为。

