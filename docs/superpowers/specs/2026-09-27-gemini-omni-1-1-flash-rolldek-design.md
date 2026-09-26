# Gemini Omni 1.1 Flash RollDek 视频接入设计

## 状态

已获用户确认，进入实施计划阶段。

## 目标

接入 RollDek 的 `gemini-omni-1.1-flash` 异步视频模型，保留现有视频生成 UI，增加首尾帧能力，同时保留参考视频能力。所有历史视频模型和线路停用；新模型成为唯一的默认模型和默认线路。每次生成固定扣除 20 金币，与视频时长无关。

RollDek 文档：<https://rolldek.com/docs/#/gemini-omni>

## 已确认的范围

- 前端继续使用现有提示词、首尾帧图片、参考视频、画面比例、分辨率、时长控件。
- 首版不增加音频上传、`seed`、`preprocess`、自定义 `n`、交互式编辑或视频续写控件。
- 模型 ID：`gemini-omni-1.1-flash`。
- 线路 ID：`gemini-omni-1.1-flash-line1`。
- 上游地址：`https://rolldek.com`。
- 上游生成接口：`POST /v1/videos`。
- 上游任务接口：`GET /v1/videos/{taskId}`。
- 上游内容接口：`GET /v1/videos/{taskId}/content`。
- 首版分辨率仅开放 `720p`。
- 首版时长仅开放 `5` 秒；完成联调后再评估开放 3–10 秒。
- 比例开放 `16:9` 和 `9:16`。
- 参考图最多 2 张，分别作为首帧和尾帧。
- 参考视频最多 1 个；图片和视频合计最多 3 个。
- 固定计费 20 金币/次。
- 旧模型和旧线路保留历史记录，但 `isActive` 和默认标记全部关闭。

## 现有代码约束

前端通过 `services/videoService.ts` 调用内部接口 `/api/video/generate`，服务端在 `server.cjs` 中解析线路、校验模型、预扣积分、转发上游请求并注册异步任务。`videoRequestPolicy.cjs` 是模型能力校验和上游请求体转换的边界。视频模型和线路既有 JSON 静态目录，也可能由 MySQL 目录覆盖；生产变更必须执行现有 `npm run migrate:pixelhub-video` 迁移。

现有 UI 已经支持 `referenceImageMode: "frames"` 和 `referenceLabels`，并允许视频参考上传。现有策略把所有 `frames` 模型都禁止视频参考，模型管理校验也禁止 `frames + supportsVideoReference`，需要改成按模型能力允许该组合。

## 目录配置

### 新模型

`config/videoModels.json` 和 `config/pixelhubVideoCatalog.json` 使用以下能力：

```json
{
  "id": "gemini-omni-1.1-flash",
  "label": "Gemini Omni 1.1 Flash",
  "description": "RollDek Gemini Omni 1.1 Flash video generation",
  "modelFamily": "gemini-omni-1.1-flash",
  "routeFamily": "gemini-omni-1.1-flash",
  "requestModel": "gemini-omni-1.1-flash",
  "selectorCost": 20,
  "pricingMode": "fixed",
  "pointCostPerSecond": 0,
  "maxReferenceImages": 2,
  "maxReferenceVideos": 1,
  "maxTotalReferences": 3,
  "referenceImageMode": "frames",
  "supportsVideoReference": true,
  "referenceLabels": ["首帧", "尾帧"],
  "defaultAspectRatio": "16:9",
  "aspectRatioOptions": ["16:9", "9:16"],
  "defaultResolution": "720p",
  "resolutionOptions": ["720p"],
  "defaultDuration": "5",
  "durationOptions": ["5"],
  "promptMaxLength": null,
  "supportsHd": false,
  "defaultHd": false,
  "isActive": true,
  "isDefaultModel": true,
  "sortOrder": 0
}
```

`pixelhubVideoCatalog.json` 只保留新模型和新线路作为服务端允许调用的目标白名单。`videoModels.json` 可以保留旧模型记录，但旧模型必须设置 `isActive: false` 和 `isDefaultModel: false`。

### 新线路

```json
{
  "id": "gemini-omni-1.1-flash-line1",
  "label": "RollDek",
  "description": "RollDek Gemini Omni 1.1 Flash",
  "routeFamily": "gemini-omni-1.1-flash",
  "line": "line1",
  "transport": "openai-video",
  "mode": "async",
  "baseUrl": "https://rolldek.com",
  "generatePath": "/v1/videos",
  "taskPath": "/v1/videos/{taskId}",
  "contentPath": "/v1/videos/{taskId}/content",
  "upstreamModel": "gemini-omni-1.1-flash",
  "allowUserApiKeyWithoutLogin": false,
  "apiKeyEnv": "ROLLDEK_GEMINI_OMNI_1_1_FLASH_KEY",
  "pointCost": 20,
  "isActive": true,
  "isDefaultRoute": true,
  "sortOrder": 0
}
```

生产环境新增：

```env
ROLLDEK_GEMINI_OMNI_1_1_FLASH_KEY=<RollDek API key>
```

## 请求数据流

前端内部请求继续保持现有结构：

```json
{
  "modelId": "gemini-omni-1.1-flash",
  "routeId": "gemini-omni-1.1-flash-line1",
  "prompt": "...",
  "aspectRatio": "16:9",
  "resolution": "720p",
  "duration": 5,
  "referenceImages": ["https://.../first.jpg", "https://.../last.jpg"],
  "referenceVideos": ["https://.../reference.mp4"]
}
```

`videoRequestPolicy.cjs` 对新模型生成 RollDek 请求：

```json
{
  "model": "gemini-omni-1.1-flash",
  "prompt": "...",
  "first_frame_url": "https://.../first.jpg",
  "last_frame_url": "https://.../last.jpg",
  "videos": ["https://.../reference.mp4"],
  "duration": 5,
  "resolution": "720p",
  "aspect_ratio": "16:9",
  "generateAudio": true,
  "n": 1
}
```

映射规则：

- 第 1 张参考图映射为 `first_frame_url`。
- 第 2 张参考图映射为 `last_frame_url`。
- 参考视频映射为 `videos`。
- 不发送 `images`，避免普通参考图和首尾帧字段重复表达。
- 固定发送 `generateAudio: true` 和 `n: 1`。
- 不发送 `start_frame`、`end_frame`、`image_urls`、`video_urls`、`audios`、`size`、`seed` 或 `preprocess`。

单独提供一张图片时，只发送 `first_frame_url`；不强制要求尾帧。

## 校验和计费

`videoRequestPolicy.cjs` 需要：

1. 对新模型允许 0–2 张图片、0–1 个视频、总数不超过 3。
2. 仅在 `referenceImageMode === "frames"` 且 `supportsVideoReference !== true` 时拒绝视频；允许 Gemini Omni 1.1 Flash 同时使用首尾帧和参考视频。
3. 保留 HTTPS、提示词、整数时长、比例、分辨率和单数量校验。
4. 计费按模型定价模式计算：`per_second` 使用时长乘单价，`fixed` 使用 `selectorCost`。新模型始终返回 20。

`videoModelStore.cjs` 的管理校验不能再无条件禁止 `referenceImageMode: "frames"` 与 `supportsVideoReference: true` 的组合；应允许该组合，并由模型的参考数量配置负责限制。

## 异步轮询和内容播放

RollDek 状态包括 `queued`、`in_progress`、`completed`、`failed`。服务端和前端轮询器都要把 `in_progress` 当作进行中状态。前端轮询间隔调整为 15 秒，与 RollDek 文档建议一致。

RollDek 完成响应把视频地址放在 `metadata.url`。前端结果提取需要读取 `task.metadata?.url` 和嵌套的 `data.metadata.url`。

RollDek `/content` 需要 Bearer Key，不能让浏览器直接访问上游地址。新增本地内容代理：

```http
GET /api/video/task/:taskId/content
```

服务端从本地任务 token 解出 `routeId` 和上游任务 ID，按原线路取得 API Key，调用 `contentPath` 并流式转发。完成任务响应应向前端返回本地内容地址，Canvas 使用本地地址播放，不暴露线路密钥。

线路类型、`videoRouteStore.cjs`、MySQL `video_routes` 表及其读写函数需要增加可选 `contentPath` 字段；旧线路为空时保持现有行为。

## UI 设计

`components/VideoFormConfig.tsx` 继续使用动态模型能力：

- 只有一条 active route 时隐藏线路选择器。
- 720p 只有一个选项，继续使用现有只读分辨率显示。
- 首尾帧模式提示用户按顺序上传。
- 参考图标签使用 `referenceLabels: ["首帧", "尾帧"]`。
- 参考视频上传继续使用现有上传接口，最多 1 个。
- 模型费用显示固定 `预计 20 金币`，不显示每秒单价。

`components/ControlPanel.tsx` 的视频参考区域将“参考图”标题改为“首尾帧”，并继续允许拖拽排序；排序后第 1 张始终是首帧、第 2 张始终是尾帧。

## 停用和迁移

- `config/videoModels.json` 中所有旧模型设置 `isActive: false`、`isDefaultModel: false`。
- `config/videoRoutes.json` 中所有旧线路设置 `isActive: false`、`isDefaultRoute: false`。
- 两个默认 ID 改为新模型和新线路。
- `config/pixelhubVideoCatalog.json` 只保留新模型和新线路。
- 生产环境执行 `npm run migrate:pixelhub-video`，该脚本会先关闭数据库中的全部视频模型和线路，再写入目标目录。
- 迁移后通过 `/api/video-models/catalog` 和 `/api/video-routes/catalog` 验证只有一个 active 模型和线路。

## 测试和验收

### 单元测试

- 目录只暴露新 active 模型和线路。
- 新模型默认 ID、默认线路 ID、固定 20 金币正确。
- 首帧映射为 `first_frame_url`。
- 尾帧映射为 `last_frame_url`。
- 首帧、尾帧和视频可以同时发送。
- 超过 2 张图片、超过 1 个视频、总素材超过 3 个会被拒绝。
- `in_progress` 被视为进行中。
- `metadata.url` 能够被提取。
- 旧模型不会通过 PixelHub 目标模型白名单。
- MySQL 迁移会停用旧目录并写入一个新目标。

### 联调验收

1. 使用 RollDek Key 提交 5 秒文生视频。
2. 提交仅首帧、首尾帧、首尾帧加参考视频三种请求。
3. 确认任务经历 `queued` 或 `in_progress` 后进入 `completed`。
4. 确认本地 `/api/video/task/:taskId/content` 能下载视频。
5. 确认 Canvas 可以播放返回的视频。
6. 确认每次生成预扣 20 金币，失败时退回 20 金币。
7. 确认旧模型 ID 和旧线路 ID 返回停用或不存在错误。

## 未纳入首版的能力

以下能力保留在后续迭代，不在本次实现：

- 参考音频 `audios`。
- 音频生成开关。
- `seed` 和 `preprocess` 控件。
- 自定义 `n` 多条生成。
- `size` 像素尺寸控制。
- Gemini Omni 的交互式编辑和视频续写。
- 3–10 秒完整时长范围，需先完成 RollDek 实测矩阵。
