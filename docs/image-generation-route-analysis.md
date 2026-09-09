# 生图模型与线路统计分析

> 数据来源：`config/imageModels.json`、`config/imageRoutes.json`、`server.cjs`、`services/api.ts`。配置文件是静态默认目录；若启用 MySQL，运行时目录可能由数据库覆盖，需以 `/api/image-models/catalog` 与 `/api/image-routes/catalog` 返回为准。

## 1. 总览

- 模型：6 个，均为启用状态。
- 线路：16 条；启用 13 条，停用 3 条。
- 传输：`openai-image` 13 条，`gemini-native` 3 条。
- 配置模式：异步 7 条，同步 9 条；其中 Visionary 线路（`visionary.beer`）的生成会被后端放入后台任务，现有 `gpt-image-2-line2` 的同步编辑也会转为后台任务。
- 上游域名：`api.bltcy.ai`、`api.pixellelabs.com`、`api.02studio.net`、`visionary.beer`。
- 计费点数按线路计：1～12 点/次；默认模型选择器成本不等于线路实际扣费。

## 2. 模型目录

| 模型 ID | 展示名 | requestModel | 尺寸 | 选择器成本 | 线路数（启用/总数） |
|---|---|---|---|---:|---:|
| `nano-banana` | Nano Banana Pro | 空（由线路 `upstreamModel` 决定） | 1k/2k/4k，默认 2k | 5 | 4/4 |
| `nano-banana-2` | Nano Banana 2 | `gemini-3.1-flash-image-preview` | 1k/2k/4k，默认 2k | 5 | 2/3 |
| `nano-banana-2-lite` | Nano Banana 2-Lite | `gemini-3.1-flash-image-preview` | 1k，默认 1k | 5 | 2/3 |
| `gpt-image-2` | GPT-Image-2 | `gpt-image-2` | 1k/2k/4k，默认 2k | 1 | 2/3 |
| `seedream-5-pro` | Seedream-5-pro | `seedream-5-pro` | 1k/2k，默认 2k | 3 | 1/1 |
| `gpt-image-2.5` | GPT-Image-2.5 | `gpt-image-2.5` | 1k/2k/4k，默认 2k | 3 | 2/2 |

## 3. 线路明细

| 线路 ID | 模型族/线路 | 状态 | 传输/模式 | 生成 URL | 任务 URL | 编辑 URL | 上游模型 | Key 环境变量 | 点数 |
|---|---|---|---|---|---|---|---|---|---:|
| `nano-banana-pro` | nano-banana / 线路一 | 启用 | OpenAI / 异步 | `https://api.bltcy.ai/v1/images/generations?async=true` | `/v1/images/tasks/{taskId}` | `/v1/images/edits?async=true` | `nano-banana-pro` | `IMAGE_ROUTE_NANO_BANANA_PRO_LINE1_KEY` | 12 |
| `nano-banana-pro-线路二` | nano-banana / 线路二 | 启用 | OpenAI / 异步 | `https://api.bltcy.ai/v1/images/generations?async=true` | 同上 | 同上 | `gemini-3.1-flash-image-preview` | `IMAGE_ROUTE_NANO_BANANA_PRO_LINE1_KEY` | 5 |
| `nano-banana-pro-line3` | nano-banana / 线路三 | 启用 | Gemini 原生 / 异步 | `https://api.pixellelabs.com/v1beta/models/{model}:generateContent` | 后端本地任务 | 不配置 | `gemini-3-pro-image-preview` | `IMAGE_ROUTE_NANO_BANANA_PRO_LINE3_KEY` | 4 |
| `nano-banana-pro-line4` | nano-banana / 线路四 | 启用 | OpenAI / 同步 | `https://visionary.beer/openapi/v1/images/generations` | `/v1/images/tasks/{taskId}`（通常不轮询） | `/v1/images/edits?async=true` | `Nano_Banana_Pro` | `IMAGE_ROUTE_VISIONARY_NANO_BANANA_PRO_LINE4_KEY` | 5 |
| `nano-banana-2-线路一` | nano-banana-2 / 线路一 | 启用 | OpenAI / 异步 | `https://api.bltcy.ai/v1/images/generations?async=true` | `/v1/images/tasks/{taskId}` | `/v1/images/edits?async=true` | `gemini-3.1-flash-image-preview` | `IMAGE_ROUTE_NANO_BANANA_PRO_LINE1_KEY` | 5 |
| `nano-banana-2-线路二` | nano-banana-2 / 线路二 | 停用 | Gemini 原生 / 同步 | `https://api.02studio.net/v1beta/models/{model}:generateContent` | 后端本地结果 | 不配置 | `gemini-3.1-flash-image` | `IMAGE_ROUTE_NANO_BANANA_PRO_LINE3_KEY` | 5 |
| `nano-banana-2-线路三` | nano-banana-2 / 线路三 | 启用 | OpenAI / 同步 | `https://visionary.beer/openapi/v1/images/generations` | 无 | 无 | `Nano_Banana_2` | `IMAGE_ROUTE_VISIONARY_NANO_BANANA_PRO_LINE4_KEY` | 5 |
| `nano-banana-2-lite-线路一` | nano-banana-2-lite / 线路一 | 启用 | OpenAI / 异步 | `https://api.bltcy.ai/v1/images/generations?async=true` | `/v1/images/tasks/{taskId}` | `/v1/images/edits?async=true` | `gemini-3.1-flash-image-preview` | `IMAGE_ROUTE_NANO_BANANA_PRO_LINE1_KEY` | 5 |
| `nano-banana-2-lite-线路二` | nano-banana-2-lite / 线路二 | 停用 | Gemini 原生 / 同步 | `https://api.02studio.net/v1beta/models/{model}:generateContent` | 后端本地结果 | 不配置 | `gemini-3.1-flash-image` | `IMAGE_ROUTE_NANO_BANANA_PRO_LINE3_KEY` | 5 |
| `nano-banana-2-lite-线路三` | nano-banana-2-lite / 线路三 | 启用 | OpenAI / 同步 | `https://visionary.beer/openapi/v1/images/generations` | 无 | 无 | `Nano_Banana_2` | `IMAGE_ROUTE_VISIONARY_NANO_BANANA_PRO_LINE4_KEY` | 5 |
| `gpt-image-2-default` | gpt-image-2 / line1 | 启用 | OpenAI / 异步 | `https://api.bltcy.ai/v1/images/generations?async=true` | `/v1/images/tasks/{taskId}` | `/v1/images/edits?async=true` | 请求模型（通常 `gpt-image-2`） | `IMAGE_ROUTE_GPT_IMAGE_2_KEY` | 1 |
| `gpt-image-2-line2` | gpt-image-2 / line2 | 启用 | OpenAI / 同步 | `https://api.pixellelabs.com/v1/images/generations` | 无 | `/v1/images/edits` | 请求模型（通常 `gpt-image-2`） | `IMAGE_ROUTE_GPT_IMAGE_2_LINE2_KEY` | 3 |
| `gpt-image-2` | gpt-image-2 / 线路一（旧） | 停用 | OpenAI / 异步 | `https://api.bltcy.ai/v1/images/generations?async=true` | `/v1/images/tasks/{taskId}` | `/v1/images/edits?async=true` | 请求模型 | `IMAGE_ROUTE_GPT_IMAGE_2_KEY` | 1 |
| `seedream-5-pro-default` | seedream-5-pro / 线路一 | 启用 | OpenAI / 同步 | `https://api.pixellelabs.com/v1/images/generations` | 无 | `/v1/images/edits` | `seedream-5-pro` | `IMAGE_ROUTE_SEEDREAM_5_PRO_KEY` | 3 |
| `gpt-image-2.5-flare` | gpt-image-2.5 / Flare（默认） | 启用 | OpenAI / 同步 | `https://api.pixellelabs.com/v1/images/generations` | 无 | `/v1/images/edits` | `gpt-image-2.5-flare` | `IMAGE_ROUTE_GPT_IMAGE_2_LINE2_KEY` | 3 |
| `gpt-image-2.5-sunburst` | gpt-image-2.5 / Sunburst | 启用 | OpenAI / 同步 | `https://api.pixellelabs.com/v1/images/generations` | 无 | `/v1/images/edits` | `gpt-image-2.5-sunburst` | `IMAGE_ROUTE_GPT_IMAGE_2_LINE2_KEY` | 3 |

## 4. 对外接口与请求参数

### 4.1 生成

`POST /api/generate`（前端 `services/api.ts -> generateImageApi`）。

请求头：`Content-Type: application/json`；平台积分模式带登录会话头，API Key 以 `Authorization: Bearer <key>` 传入。允许直连用户 Key 的线路会跳过平台扣费（当前配置默认未开启该开关）。

通用 JSON：

```json
{
  "uiMode": "canvas",
  "modelId": "nano-banana-2",
  "routeId": "nano-banana-2-线路一",
  "model": "gemini-3.1-flash-image-preview",
  "prompt": "...",
  "n": 1,
  "size": "2k",
  "image_size": "2k",
  "aspect_ratio": "1:1",
  "quality": "auto",
  "output_format": "png",
  "moderation": "auto"
}
```

`modelId`/`routeId` 由后端解析；最终 `model` 通常被线路的 `upstreamModel` 覆盖。`size` 会按模型处理：GPT-Image-2 转为具体 `WxH`（按比例和 1k/2k/4k），Gemini 原生转为 `generationConfig.imageConfig.imageSize`，Visionary 兼容字段还会补 `imageSize`、`ratio`，Doubao 兼容逻辑会把档位转为像素尺寸。

### 4.2 编辑

`POST /api/edit`（前端 `editImageApi`）。表单逻辑由后端按线路转为 `multipart/form-data`：

- 必填：`model`、`prompt`、`image`（base64 或 data URL）；可选 `mask`。
- 通用：`n`、`size`、`image_size`、`aspect_ratio`。
- GPT-Image-2：`quality`、`output_format`、`moderation`、非 PNG 时的 `output_compression`，图片字段可重复上传多个 `image`。
- 其他 OpenAI 图片线路：`image`、`mask` 作为文件字段。

### 4.3 任务查询

- OpenAI 异步：`GET /api/task/:taskId`，后端解码本地 task token 后请求线路 `taskPath`。
- Gemini 原生异步及 Visionary 后台任务：同样查询 `/api/task/:taskId`，但由后端本地任务表/内存状态承接，不直接调用上游 taskPath。
- 线路同步结果直接返回图片 URL 或 `images/data`；Visionary 与 GPT-Image-2 line2 的部分操作会被后端转为后台任务以统一前端体验。

## 5. Gemini 原生上游实际 Body

`POST {baseUrl}/v1beta/models/{upstreamModel}:generateContent`，后端优先发送 camelCase，400 时会尝试 snake_case/无 config 兼容体：

```json
{
  "contents": [{
    "role": "user",
    "parts": [
      {"text": "prompt"},
      {"inlineData": {"mimeType": "image/jpeg", "data": "<base64>"}}
    ]
  }],
  "generationConfig": {
    "responseModalities": ["IMAGE"],
    "candidateCount": 1,
    "imageConfig": {"aspectRatio": "1:1", "imageSize": "2K"}
  }
}
```

有 `thinking_level` 时增加 `generationConfig.thinkingConfig.thinkingLevel`。URL 鉴权使用线路 `apiKeyEnv` 对应 Key，并带 `Authorization`；同时兼容把 Key 作为 `key` 查询参数的网关重试策略。

## 6. 运行时统计与风险

- 静态目录中 `nano-banana-pro-线路二` 与 `nano-banana-2-线路一`、`nano-banana-2-lite-线路一` 复用了同一个 `IMAGE_ROUTE_NANO_BANANA_PRO_LINE1_KEY`，需要确认这是有意的密钥池还是配置错误。
- 两条停用的 `02studio` Gemini 线路仍保留在配置中，但公共目录默认过滤停用项；管理端可查看。
- `gpt-image-2` 存在一个旧的停用 route ID，与 `gpt-image-2-default` 功能重复，建议后续清理或明确迁移关系。
- 公共目录接口只返回线路元数据，不返回 `baseUrl`、路径和密钥环境变量；完整线路表应只在服务端配置/管理员环境使用。
- 若要统计真实调用量、成功率、耗时和点数消耗，应查询 generation records / admin dashboard（静态配置只能统计容量，不能代表历史流量）。

