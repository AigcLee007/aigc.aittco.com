# GPT-Image-2.5 Sunburst RollDek 线路与质量参数设计

## 目标

为 `gpt-image-2.5-sunburst` 增加两条 RollDek 线路，并按图片尺寸收取不同点数：

- 原生线路：`https://rolldek.com`，环境变量 `ROLL_IMAGE2.5_BIG_KEY`，1K/2K/4K 分别为 3.5/4/4.5 点。
- 官渠高质：`https://rolldek.com`，环境变量 `ROLL_IMAGE2.5_MAX_KEY`，1K/2K/4K 分别为 5/5.5/6 点。

现有官key线路与新增两条线路支持 `auto`、`low`、`medium`、`high`、`xhigh`、`max`；现有备用线路继续只支持 `auto`、`low`、`medium`、`high`。

## 目录与线路模型

在 `config/imageRoutes.json` 中为 Sunburst 增加两条 `openai-image`、同步请求线路，基础地址为 `https://rolldek.com`，生成路径和编辑路径沿用 `/v1/images/generations` 与 `/v1/images/edits`。线路使用 Sunburst 的尺寸上游模型映射：1K 为 `gpt-image-2.5-sunburst`，2K 为 `gpt-image-2.5-sunburst-2k`，4K 为 `gpt-image-2.5-sunburst-4k`。

线路字段增加 `supportedQualities`，并在 TypeScript 目录类型、服务端公开目录及规范化逻辑中保留该字段。默认能力为完整六项；备用线路显式配置四项。前端不依赖中文线路名称判断能力。

建议线路 ID：

- `gpt-image-2.5-sunburst-native`，显示名“原生线路”。
- `gpt-image-2.5-sunburst-max`，显示名“官渠高质”。

两条线路的排序放在官key线路之后、备用线路之前；不改变现有默认线路。

## 计费与请求流程

尺寸点数写入 `sizeOverrides` 的 `pointCost`，服务端已有 `getRoutePointCost` 按请求中的 `image_size` 选择覆盖值，并乘以 `n`。因此新增线路的实际扣点为：

- 原生线路：1K 3.5、2K 4、4K 4.5。
- 官渠高质：1K 5、2K 5.5、4K 6。

请求仍使用现有 GPT 图片兼容格式，质量值原样透传给上游；服务端不把 `xhigh` 或 `max` 降级为其他值。线路目录和前端负责表达可选能力。

## 前端行为

React 控制面板从选中线路的 `supportedQualities` 生成质量选项。当前质量若在线路切换后不再受支持，则回退到 `auto`。新增 `xhigh` 和 `max` 的类型、选项和持久化状态，并保持现有请求 payload 字段 `quality` 不变。

经典界面从公开线路目录读取同一能力字段，在备用线路隐藏 `xhigh`/`max`，在其余 Sunburst 线路显示完整六项；本地保存的旧质量值若当前线路不支持，则回退到 `auto`。

## 测试与验证

补充或更新以下测试：

- 静态目录测试：Sunburst 路线包含五条线路、线路 ID/URL/Key 环境变量/尺寸点数/质量能力正确，备用线路保持四项质量。
- 路由目录规范化与公开目录测试：`supportedQualities` 不丢失，缺省值为完整六项。
- 计费测试：新增线路按 1K/2K/4K 和 `n` 计算点数。
- 前端类型与质量选项测试：备用线路四项，其余 Sunburst 线路六项；不支持的旧值回退到 `auto`。

使用相关 Vitest 测试和生产构建验证。仅提交本次规格文档及实现相关文件，不纳入工作区中已有的无关未跟踪图片或缓存目录。
