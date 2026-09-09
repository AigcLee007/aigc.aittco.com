# GPT-Image-2.5 双线路接入设计

## 目标

新增一个内部模型 `gpt-image-2.5`，并为其提供两条可切换线路：`gpt-image-2.5-flare` 与 `gpt-image-2.5-sunburst`。两条线路使用同一个 PixelleLabs 上游地址、同一个 API Key 和 GPT-Image-2 兼容的生成/编辑参数格式。

## 已确认约束

- 模型展示名：`GPT-Image-2.5`
- 内部模型 ID：`gpt-image-2.5`
- 线路 ID：`gpt-image-2.5-flare`、`gpt-image-2.5-sunburst`
- 实际上游模型名分别为 `gpt-image-2.5-flare`、`gpt-image-2.5-sunburst`
- 生成地址：`https://api.pixellelabs.com/v1/images/generations`
- 编辑地址：`https://api.pixellelabs.com/v1/images/edits`
- 传输：`openai-image`
- 模式：`sync`
- 尺寸：`1k`、`2k`、`4k`，默认 `2k`
- 质量、输出格式、压缩率、审核强度、数量、参考图和遮罩参数沿用现有 GPT-Image-2
- API Key 复用 `IMAGE_ROUTE_GPT_IMAGE_2_LINE2_KEY`
- 线路点数默认沿用现有 `gpt-image-2-line2` 的 3 点/次，Flare 作为默认线路

## 数据模型

模型目录新增一条记录，`modelFamily` 和 `routeFamily` 均为 `gpt-image-2.5`，`requestModel` 为 `gpt-image-2.5`，`sizeOptions` 为 `["1k", "2k", "4k"]`，使用 default panel 和 GPT 兼容参数能力。

线路目录新增两条记录。两条记录的 `baseUrl`、`generatePath`、`editPath`、`apiKeyEnv`、`transport`、`mode` 和点数相同，仅 `id`、`label`、`line`、`upstreamModel` 不同。通过独立 route ID 保留线路级启停、默认线路、价格和调用统计能力，同时避免复制模型选项。

## 请求数据流

1. 前端选择 `gpt-image-2.5` 和其中一条线路，提交 `modelId`、`routeId`、prompt、尺寸和 GPT 参数。
2. 后端先按 `modelId`/`routeId` 解析模型与线路，并依据线路的 `upstreamModel` 将请求模型设置为 `gpt-image-2.5-flare` 或 `gpt-image-2.5-sunburst`。
3. 生成请求进入现有 OpenAI 图片兼容分支，向 `/v1/images/generations` 发送 JSON。
4. 编辑请求进入现有 multipart 分支，向 `/v1/images/edits` 发送 `model`、`prompt`、图片、可选 mask 以及 GPT 参数。
5. 同步线路直接返回图片结果；如果上游返回任务状态，继续使用现有任务兼容处理。

生成 JSON 的核心字段：

```json
{
  "model": "gpt-image-2.5-flare",
  "prompt": "...",
  "size": "2048x2048",
  "quality": "auto",
  "output_format": "png",
  "moderation": "auto",
  "n": 1
}
```

## 兼容性改造

现有代码中 GPT-Image-2 判断分布在后端、画布版和经典版。实现时应将 GPT 图片格式判断扩展为兼容模型族/前缀，而不是只在单个位置追加两个字符串。这样模型 ID 与线路上游模型名都能进入同一套尺寸归一化、质量、输出格式、审核、编辑和参考图逻辑。

模型选择器只显示一个 GPT-Image-2.5；线路选择器显示 Flare 和 Sunburst。切换线路不改变模型参数，只改变 `routeId` 以及最终上游 `model`。

## 文件范围

- `config/imageModels.json`：新增一个模型
- `config/imageRoutes.json`：新增两条线路
- `server.cjs`：扩展 GPT 兼容模型判断和线路上游模型解析
- `components/ImageFormConfig.tsx`、`components/ControlPanel.tsx`：复用 GPT 控件和 payload
- `src/config/imageEditCapabilities.ts`：将新模型归入 GPT 编辑能力组
- `public/classic-app/script.js`、`public/classic-app/unified-bridge.js`：经典版模型与线路目录、GPT payload 判断
- `src/config/imageModels.test.ts` 及必要的请求策略测试：覆盖目录、线路和请求格式

不新增环境变量；`.env` 中只需已有的 `IMAGE_ROUTE_GPT_IMAGE_2_LINE2_KEY`。

## 数据库与部署

现有 MySQL 目录初始化会按静态目录增量写入缺少的模型和线路 ID，因此新部署和已有数据库都能获得新增记录。已有同 ID 记录不会被静态文件覆盖，生产环境若已经手工配置同名记录，以数据库配置为准。

## 测试与验收

- 模型目录包含且只增加一个 `gpt-image-2.5` 模型，尺寸为 1K/2K/4K。
- 线路目录包含两条启用线路，二者 URL、Key、传输和模式一致，上游模型名分别正确。
- 画布版和经典版均显示 GPT 参数控件，并在两条线路之间正确切换。
- 生成请求分别发送 `gpt-image-2.5-flare` 和 `gpt-image-2.5-sunburst`。
- 编辑请求继续发送 GPT-Image-2 同款 multipart 字段。
- 1K、2K、4K 尺寸均经过现有尺寸归一化逻辑。
- 现有模型、线路、任务查询和完整测试套件不回归。

