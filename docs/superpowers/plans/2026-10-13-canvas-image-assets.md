# Canvas Image Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消除 VIP 与画布图片的无限 `Loading asset`，让已有图片在刷新、重新挂载和缓存缺失时可预测地恢复，并限制两处页面的原图内存占用；随后引入预览图与共享读取，最后为成功生成结果补齐可跨设备恢复的本站持久保存。

**Architecture:** 把图片分为三个层次：持久引用（`assetId`、远程 URL、本站 `remoteAssetId`）、运行时读取状态（loading/ready/missing/error 和 Object URL 生命周期）、图片变体（preview/original）。第一阶段修复两种页面的读取状态和本地恢复，并用有上限的原图加载租约做崩溃防护；第二阶段让两种页面都优先显示小预览、按需读原图，并共享同一资产的读取；第三阶段在服务端增加独立图片资产索引与可重试保存队列。所有阶段都保持现有 `NodeData` 和生成响应向后兼容，并允许单独回滚。

**Tech Stack:** React 19、Zustand、Konva/react-konva、IndexedDB (`idb-keyval`)、Vitest/jsdom、Node.js/Express、现有 `sharp` 与 MySQL/file 存储适配器。

**2026-10-13 执行状态：** 用户已授权执行修复。本轮实施阶段 1、2 的图片读取、本地恢复、预览与共享读取、内存释放；第 3 阶段本站保存暂缓。实际文件分工、验证结果与测试范围见 `docs/image-assets-repair-verification-2026-10-13.md`。尚未部署；下方发布、生产监控和第 3 阶段待办保持未完成，不把开发验证当作线上验收。

---

## 当前问题边界

- `components/CanvasNode.tsx` 只把 `!image` 渲染成 `Loading asset...`，没有区分空 `src`、远程 404、IndexedDB 缺失、Blob 解码失败和仍在生成的任务。
- 生成结果在 `src/hooks/useGenerationLogic.ts` 中分别显示远程 URL、下载文件、读取尺寸和写入 IndexedDB；后台写回没有确认节点仍是同一张图片。
- `App.tsx` 只在没有远程 `src` 或 `src` 是 `blob:` 时恢复本地 Blob，且 hydration 屏障是固定 1 秒；有远程 URL 时不会尝试本地恢复。
- `src/services/localCacheMaintenance.ts`、参考图移除逻辑和 undo/redo 没有一个完整的资产引用集合，可能提前删除仍被使用的 Blob。
- 用户截图地址是 `/vip`，它由 `public/classic-app/index.html` 加载，不是 `InfiniteCanvas`。VIP 桌面模式最多保留 30 个 live tasks；`renderClassicLiveTasks()` 每次状态变化都清空并重建整个列表，成功项在缺少 preview URL 时直接把原图 URL 放进每张卡片。`loading="lazy"` 只延迟加载，不保证已解码的大图退出内存。
- 画布也有独立的原图内存风险：`components/CanvasNode.tsx` 的 `ImageNode` 把 `node.src` 直接交给 `useImage`；quiet image 的 Konva Group 会建立额外 cache。视口裁剪只限制视口外节点挂载，不控制多个可见大图的解码内存，也没有按解码像素数分配原图预算。
- 4K 的 3840×2160 图片解码后约为 31.6 MiB（像素数 × 4 字节，尚未计入浏览器/GPU副本）；30 张同时解码的理论像素内存约 950 MiB。因此 VIP 结果页存在高内存风险，但仍需用真实浏览器曲线和用户步骤确认实际崩溃路径。
- `downloadSingleImg()` 为下载建立的 Object URL 当前没有 revoke；lightbox 关闭时也只隐藏窗口、没有清空大图 `src`。这些是可直接修正的生命周期问题。
- `D:\gpt-iamge-2` 的任务卡先读最长边 720 的缩略图；完整图的内存缓存最多 8 项，缩略图缓存最多 80 项，缩略图后台补齐限制并发。当前 VIP 卡片没有统一缩略图保障，当前 Canvas 节点也直接把原图交给 `useImage`。
- `D:\gpt-iamge-2` 的原图/缩略图分层、版本化缩略图、共享读取、并发限制可以借鉴；当前项目继续使用 Blob/IndexedDB，不把所有图片改成 Base64。
- 本计划不修改生成请求提交、上游轮询、扣点、计费或现有超时改动；“请求延迟”另行处理。

## 文件职责图

### 阶段 1：无限 Loading 与本地恢复

- **Create:** `src/services/imageAssetTypes.ts` — 资产引用、候选来源、运行时状态和恢复结果类型。
- **Create:** `src/services/imageAssetResolver.ts` — 本地 Blob、明确远程 URL、旧数据兼容候选的有界读取与错误分类。
- **Create:** `src/hooks/useImageAsset.ts` — React 订阅层；按 `assetId/src/thumbnailSrc` 读取、版本保护、Object URL 释放。
- **Create:** `src/services/imageMemoryBudget.ts` — 以像素字节估算为权重的有限原图租约；可见/选中图片优先，非租约图片走预览或明确的待加载状态。
- **Modify:** `src/services/assetStorage.ts` — Blob 校验、可复用 Object URL、统一释放；删除只由引用清理层调用。
- **Modify:** `components/CanvasNode.tsx` — 显示 ready/reading/missing/failed 状态；重试只读资源。
- **Modify:** `components/CanvasNode.tsx`, `components/InfiniteCanvas.tsx`, `src/hooks/useImageAsset.ts` — 画布图片申请/释放原图租约、切换节点时释放运行时资源，并避免超预算时无限 Loading。
- **Modify:** `public/classic-app/script.js`, `public/classic-app/unified-bridge.js` — VIP 结果图限制原图常驻数量、保留任务记录但避免每次状态更新重载整页图片，释放 lightbox 和下载 URL。
- **Modify:** `src/hooks/useGenerationLogic.ts` — 资产版本和节点身份保护，替换图片时解绑旧资产。
- **Modify:** `src/store/canvasStore.ts`, `types.ts`, `src/store/historyStore.ts` — 持久化错误终态、历史资产引用，清除运行时 URL。
- **Modify:** `src/services/localCacheMaintenance.ts`, `src/store/selectionStore.ts`, `src/commands/types.ts`, `src/commands/HistoryManager.ts`, `src/commands/nodeCommands.ts` — 集中收集 canvas/history/reference/undo/redo/in-flight 引用，禁止引用仍在使用时删除。
- **Create tests:** `src/services/imageAssetResolver.test.ts`, `src/hooks/useImageAsset.test.tsx`, `src/services/localCacheMaintenance.test.ts`, `src/store/canvasStore.persistence.test.ts`。
- **Create tests:** `src/services/imageMemoryBudget.test.ts`, `src/hooks/canvasImageMemory.test.tsx`, `public/classic-app/image-memory.test.cjs`。

### 阶段 2：预览图与共享读取

- **Modify:** `src/services/assetStorage.ts` — 同一 `assetId` 的 original/preview/meta 键和事务写入，兼容现有 `asset-${id}` 原图键。
- **Create:** `src/services/imageAssetCache.ts` — 共享读取 Promise、变体 key、失败重试规则、LRU/字节和解码像素预算。
- **Create:** `src/services/imagePreview.ts` — 使用浏览器 `createImageBitmap`/canvas 生成 WebP 预览并记录版本。
- **Modify:** `src/hooks/useImageAsset.ts`, `components/CanvasNode.tsx`, `components/MobileView.tsx`, `components/SettingsModal.tsx`, `src/layouts/ModalsContainer.tsx`, `public/classic-app/script.js`, `public/classic-app/unified-bridge.js` — 预览优先、原图按需和缺失态一致。
- **Modify:** `src/hooks/useCanvasOperations.ts`, `src/hooks/useImageProcessor.ts`, `components/ContextMenu.tsx`, `src/hooks/useGenerationLogic.ts` — 生成、导入、去背景、替换、复制都写入统一资产记录。
- **Modify:** `App.tsx`, `components/ImageEditPanel.tsx`, `src/store/selectionStore.ts` — lightbox、编辑、参考图、下载全部请求 original variant，不拿预览代替原图。
- **Create tests:** `src/services/imageAssetCache.test.ts`, `src/services/imagePreview.test.ts`, `src/hooks/useCanvasOperations.assets.test.tsx`。

### 阶段 3：本站保存与共享恢复

- **Modify:** `generatedAssetService.cjs` — provider 接口、原图/预览元数据、幂等保存、独立 TTL 和清理入口。
- **Modify:** `server.cjs` — 在现有 `persistImageResultPayloadSafe` 成功路径统一入队，新增认证的资产列表/恢复接口，保持生成响应字段兼容。
- **Create:** `generatedAssetStore.cjs` and `generatedAssetStore.mysql.cjs` — 独立资产索引（不要复用短期 `generation_records` 作为唯一存储）。
- **Create:** `generatedAssetQueue.cjs` — 事务外可恢复队列、租约、指数退避、幂等键和服务重启恢复。
- **Modify:** `services/api.ts` (如前端需要) — 资产恢复 API 客户端和拥有者错误映射。
- **Modify:** `src/services/imageAssetResolver.ts` — local → 本站稳定资产地址 → 上游 URL 的候选顺序。
- **Create tests:** `generatedAssetStore.test.cjs`, `generatedAssetQueue.test.cjs`, `server.generated-assets.test.cjs`。
- **Docs:** `docs/generated-assets.md` — 以实际 provider 配置和保留策略为准更新，不宣称尚未接入的 OSS/S3 已覆盖全部线路。

## 数据契约与不变量

### 持久引用

```ts
export type AssetVariant = 'original' | 'preview';

export interface AssetRef {
  assetId?: string;          // 浏览器 IndexedDB Blob ID，不含 "asset-" 前缀
  remoteAssetId?: string;   // 本站稳定资产 ID，与本地 ID 完全分开
  src?: string;             // canonical 远程 URL；不得持久化 blob:/data:
  thumbnailSrc?: string;    // 可选远程预览 URL
  originalMimeType?: string;
  originalBytes?: number;
  width?: number;
  height?: number;
  thumbnailVersion?: number;
}
```

`NodeData` 和 `GenerationLog` 只保存上述持久引用及业务字段；Object URL、`HTMLImageElement`、Promise、AbortController 和读取状态都属于运行时 Map/hook，禁止写回 Zustand 持久化数据。历史项扩展为 `src?`, `assetId?`, `remoteAssetId?`, `thumbnailSrc?`，旧的只有 `src` 数据仍可读取。

### 读取状态机

```ts
export type ImageAssetStatus =
  | 'idle'       // 尚未开始读取
  | 'generating' // 有 taskId 且仍在生成，保留生成进度 UI
  | 'reading'    // 正在读取有限候选
  | 'ready'
  | 'missing'   // 没有任何候选或所有候选明确不存在
  | 'failed';    // 候选存在但解码/网络/权限失败，展示可重试终态
```

读取器必须满足：

1. 空 `src`、空 `assetId` 且没有 `taskId` 立即进入 `missing`，不得显示无限 Loading。
2. 每个候选读取有初始建议 15 秒超时；整个读取周期初始建议 45 秒，最多两次有限重试。参数先配置化，压测后再调整。
3. 页面隐藏时浏览器计时器可能被节流，不能承诺后台准时；回到前台时按 `lastAttemptAt + deadline` 立即判定并最多补一次读取。
4. 本地 Blob 损坏时删除运行时 URL 并尝试远程/本站候选；不得在读取失败时自动删除持久 Blob。
5. 每次异步结果带 `{ nodeId, assetGeneration }`；节点删除、图片替换或 assetId 改变后，旧 Promise 的结果必须丢弃。
6. “重试”只调用 resolver/cache 的重新读取，不触发生成 API、轮询、扣点或计费。

## 阶段 1：先消除无限 Loading 并修复本地缓存恢复

### Task 1: 建立失败基线和旧缓存夹具

**Files:**

- Modify: `src/test/setup.ts`（补齐 `URL.createObjectURL/revokeObjectURL`、`Image`/`fetch` 测试桩）
- Create: `src/services/imageAssetResolver.test.ts`
- Create: `src/store/canvasStore.persistence.test.ts`

- [ ] 写出四个失败用例：远程 404 但本地 Blob 可用；本地缺失但远程可用；两者都不可用最终 `missing/failed`；旧节点 hydration 后不会把 `blob:` 写回持久 `src`。
- [ ] 执行 `npm test -- src/services/imageAssetResolver.test.ts src/store/canvasStore.persistence.test.ts`，预期新用例在 resolver/状态类型尚不存在时失败。
- [ ] 只添加测试夹具，不清理现有 IndexedDB、Chrome profile 或用户图片；若引入真实 IDB 事务测试，增加 `fake-indexeddb` devDependency 并在测试文件显式安装，不用全量 mock 掩盖事务问题。
- [ ] 执行 `git diff --check`，确认基线测试失败原因是缺少目标行为，不是测试环境损坏；独立提交测试基线。

### Task 2: 实现有界 resolver 与统一运行时 URL 生命周期

**Files:**

- Create: `src/services/imageAssetTypes.ts`
- Create: `src/services/imageAssetResolver.ts`
- Create: `src/hooks/useImageAsset.ts`
- Modify: `src/services/assetStorage.ts`

- [ ] 为 resolver 实现以下接口：

```ts
export interface ResolveInput {
  assetId?: string;
  src?: string;
  thumbnailSrc?: string;
  variant?: 'original' | 'preview';
  signal?: AbortSignal;
  deadlineMs?: number;
}

export interface ResolveResult {
  status: 'ready' | 'missing' | 'failed';
  url?: string;
  source?: 'local' | 'remote' | 'remote-preview';
  errorCode?: 'EMPTY' | 'NOT_FOUND' | 'TIMEOUT' | 'DECODE' | 'NETWORK' | 'UNSUPPORTED';
}

export function resolveImageAsset(input: ResolveInput): Promise<ResolveResult>;
```

- [ ] 固定候选顺序：original 先查 IndexedDB（有 `assetId` 时），再查 canonical `src`，最后才查 `thumbnailSrc`；preview 先查 preview，再回退 original。远程读取用 AbortController，响应成功后验证 Blob/image 解码，不把 HTTP 200 的 HTML 错页当图片。
- [ ] 在 `assetStorage.ts` 增加 `getBlobUrl(assetId)` 的会话级 URL 缓存、`releaseBlobUrl(assetId)` 和 `isValidAssetBlob(blob)`；`deleteBlob` 只删除 IndexedDB 数据，不撤销其他消费者仍在使用的 URL。组件卸载或资产版本变化才 release。
- [ ] `useImageAsset` 以 `assetKey = assetId|remoteAssetId|src|thumbnailSrc|variant` 区分请求，使用 ref 记录 generation；effect cleanup 取消当前读取，只有最新 generation 能设置状态。
- [ ] 对本地丢失、远程失败、解码失败分别映射 `missing` 或 `failed`，不再用一个未结束的 Promise 永久保持 loading。
- [ ] 执行 `npm test -- src/services/imageAssetResolver.test.ts src/store/canvasStore.persistence.test.ts`，预期 Task 1 的四个用例通过。
- [ ] 执行 `npx tsc --noEmit`；如有既存 baseline，记录完整错误并只修复本任务新增错误。独立提交 resolver。

### Task 3: 让画布显示终态，并保护晚到结果

**Files:**

- Modify: `components/CanvasNode.tsx`
- Modify: `src/hooks/useGenerationLogic.ts`
- Modify: `types.ts`
- Create: `src/hooks/useImageAsset.test.tsx`

- [ ] `CanvasNode` 使用 `useImageAsset`：`loading`/`taskId` 仍显示生成占位；`reading` 显示有限读取提示；`missing` 显示“本地图片已清理或链接已失效”；`failed` 显示“图片读取失败”和只读重试按钮；`ready` 渲染 Konva Image。
- [ ] 重试按钮在 `onClick`/`onTap` 中调用 `stopPropagation()`，只增加 resolver generation，不调用任何生成回调；键盘 Enter/Space 也触发同一个读取重试。
- [ ] 保留现有 remote proxy 规则和跨域编辑要求：proxy、直连、blob/data URL 的选择由 resolver 统一决定，不无条件把跨域 URL 当作可编辑资源。
- [ ] 当 URL/assetId/preview-to-original 变化时，把 `isResourceLoaded` 复位并清除 Konva cache；图片 ready 后再缓存，避免旧图继续绘制。
- [ ] `useGenerationLogic.ts` 给每次图片结果分配递增 `assetGeneration`，后台下载/尺寸读取/Blob 回填前检查 node 仍存在、taskId/assetGeneration 仍相同；替换结果时清除旧 `assetId` 绑定并由引用清理层决定何时删除旧 Blob。
- [ ] 执行 `npm test -- src/hooks/useImageAsset.test.tsx`，覆盖组件卸载、替换图片后旧 Promise 晚到、点击重试零生成请求三例。
- [ ] 在浏览器手动验收：远程 404+本地可用、远程可用+本地丢失、双丢失、生成失败节点、成功图卸载后重新进入视野；都不能无限显示 `Loading asset...`。

### Task 4: 限制 VIP 和画布页面的原图内存与临时 URL 生命周期

**Files:**

- Modify: `public/classic-app/script.js`
- Modify: `public/classic-app/unified-bridge.js`
- Modify: `components/CanvasNode.tsx`
- Modify: `components/InfiniteCanvas.tsx`
- Modify: `src/hooks/useImageAsset.ts`
- Create: `src/services/imageMemoryBudget.ts`
- Create: `src/services/imageMemoryBudget.test.ts`
- Create: `src/hooks/canvasImageMemory.test.tsx`
- Create: `public/classic-app/image-memory.test.cjs`

- [ ] 先用测试复现：插入/更新 30 个成功任务后，VIP DOM 只挂载有 preview 的卡片缩略图；没有 preview 的旧任务显示轻量占位，不得把 30 张 full URL 同时交给 `<img>`。任务仍保留在 `classicLiveTasks`/IndexedDB，可逐张打开原图或分页查看。
- [ ] 修改 live-task 渲染为按 task id 更新，不因一个任务轮询变化而销毁并重建所有成功图片节点；现有 30 条桌面记录上限继续只限制记录数，不代表允许 30 张原图同时解码。
- [ ] 设置原图加载预算：普通 VIP 列表最多 1 张原图同时加载（用户打开 lightbox 时），关闭 lightbox 清空 `lbImg.src`；预览图只允许来自真实 preview URL，不能把原图 URL 假称缩略图。
- [ ] 在 `src/services/imageMemoryBudget.ts` 实现 `acquireOriginalImageLease(key, width, height, priority)` / `releaseOriginalImageLease(key)`：按 `width * height * 4` 记账，以可见节点和选中节点优先；初始建议 96 MiB 解码像素预算，超预算时返回 deferred，不创建无限排队或同时解码。该预算是应用可控图像像素估算，不等同浏览器实际 RSS。
- [ ] 记账宽高必须使用 original 的真实像素尺寸（资产 meta 或解码尺寸），不能使用画布上的 `node.width/node.height` 显示尺寸。未知尺寸先按保守的大图档位预留、限制并发，尺寸确认后校正；单张大图超过预算时用受控的单图模式或降采样显示，原图下载字节保持不变。
- [ ] CanvasNode 只有持有 original lease 才能把原图交给 `useImage`；视口裁剪卸载、换图、节点删除时释放 lease 和对应运行时 URL。预算不足且没有 preview 时显示可恢复的“等待原图空间/点选查看”状态，不能把资源当成失败或无限 Loading。
- [ ] 对 Konva Group 的 image cache 做内存对照；默认关闭会复制大图像素的 cache，只有浏览器验收证明 cache 减少总内存且切图时正确清除，才允许保留。
- [ ] `downloadSingleImg()` 下载完成后延迟 revoke 自己创建的 object URL；下载失败时不创建长期 URL。历史页清理 `historyObjectUrls` 时同步把已卸载图片节点切换回 canonical URL/占位，避免页面仍引用已 revoke 的 URL。
- [ ] 执行 `npm test -- src/services/imageMemoryBudget.test.ts src/hooks/canvasImageMemory.test.tsx public/classic-app/image-memory.test.cjs`，断言 VIP 30 条任务仍可访问但同一时刻最多 1 张原图；Canvas 超预算时有界延期、选中图优先、移出视口释放租约；重复更新/切图后租约数不增长，关闭 lightbox 释放原图引用，下载 URL 会 revoke。
- [ ] 用真实 Edge/Chrome Developer Tools 分别对 VIP 30 张和 Canvas 50 个可见 4K 节点比较修改前后的 renderer memory 和已解码像素估算；目标是原图解码受预算限制、反复更新/平移后内存回落，而不是只检查 IndexedDB 文件大小。
- [ ] 分别记录两个页面冷启动、加载多图、重复 20 次历史/创作切换或画布平移、打开/关闭原图、连续使用 30 分钟的 renderer/graphics 内存曲线。对比同浏览器同设备同图片集，确认已释放租约/Object URL 数量不随轮次持续增长；没有崩溃只作为本次压力场景的验收结果，不承诺所有设备绝不 OOM。

### Task 5: 持久化恢复状态并修正引用安全清理

**Files:**

- Modify: `src/store/canvasStore.ts`
- Modify: `src/store/historyStore.ts`
- Modify: `types.ts`
- Modify: `src/services/localCacheMaintenance.ts`
- Modify: `src/store/selectionStore.ts`
- Modify: `src/commands/types.ts`, `src/commands/HistoryManager.ts`, `src/commands/nodeCommands.ts`
- Modify: `App.tsx`
- Create: `src/services/localCacheMaintenance.test.ts`

- [ ] sanitizer/merge 保留 `error`, `errorMessage`, `generationStartedAt`, `history`, `historyIndex` 和资产引用；移除 `blob:`/`data:`/超长 URL，但永不清除 `assetId`/`remoteAssetId`。
- [ ] `HistoryItem` 增加可选 `assetId`, `remoteAssetId`, `thumbnailSrc`；迁移旧 history 时从 `src` 中识别 `asset-<id>` 只作为兼容候选，不能把任意 URL 正则误认成本地资产。
- [ ] `App.tsx` 改为等待真实 Zustand hydration 完成后再运行 cache maintenance；移除固定 1 秒作为恢复完成标志。资产恢复按节点 assetId 懒加载，禁止把短期 Object URL 写回持久化 `src`。
- [ ] 资产引用收集包含：canvas 当前节点、node.history、historyStore、selection referenceImages、undo/redo command 快照和 in-flight generation；清理前重新读取一次引用集合，并给未知旧资产至少一个维护周期宽限。维护失败只记录日志，不删除任何 Blob。
- [ ] `selectionStore.removeReferenceImage/clearReferenceImages` 改成解除引用并触发集中清理，不能直接 `deleteBlob`；删除后立即 undo 时原图仍应可恢复。
- [ ] `Command` 增加可选 `getAssetIds?: () => Iterable<string>`；各图片相关 command 返回 old/new nodes 的全部资产 ID，`HistoryManager` 在 history/future 两栈都可枚举引用，避免循环导入 store。
- [ ] 执行 `npm test -- src/services/localCacheMaintenance.test.ts src/store/canvasStore.persistence.test.ts`，覆盖 reference 删除后 undo、后台清理与 hydration 竞态、旧 history 兼容。
- [ ] 执行 `npm run build` 与 `npx tsc --noEmit`，记录既有错误与新增错误；独立提交第一阶段代码。

### 阶段 1 验收与发布

- [ ] 发布前保留旧构建和 IndexedDB，不执行清库迁移；先对内部账号灰度。
- [ ] 真浏览器验收矩阵覆盖 `/vip` 与 Canvas：正常远程、远程 404、本地命中、本地损坏、无候选、页面隐藏后回前台、节点移出/回到视野、替换图晚到、生成失败、重试按钮、刷新恢复、撤销/重做、参考图删除；用 4K 多图场景确认两种页面都不超过阶段一原图预算且最终不留下永久 Loading。
- [ ] 监控 `image_asset_resolve_total{status,source,errorCode}`、平均/95 分位读取时长、`assetId` 命中率、重试次数和 `Loading asset` 超过整体 deadline 的节点数；不采集图片内容和密钥。
- [ ] 回滚只替换前端 bundle；旧持久字段保持兼容，旧 Blob 不删除，回滚后仍可由旧代码读取。

## 阶段 2：预览图与共享读取

### Task 6: 增加原图/预览图存储模型

**Files:**

- Modify: `src/services/assetStorage.ts`
- Create: `src/services/imagePreview.ts`
- Modify: `types.ts`, `src/store/historyStore.ts`, `src/store/canvasStore.ts`
- Create: `src/services/imagePreview.test.ts`

- [ ] 为每个浏览器 `assetId` 增加 `asset-meta-${id}`、`asset-preview-${id}` 键；原图仍使用现有 `asset-${id}` 键，读取旧资产无需迁移。
- [ ] `storeAsset({originalBlob, mimeType, width, height})` 在一个可观测事务中先保原图，再生成/保存预览和 meta；预览初始建议最长边 1024、WebP quality 0.82、`thumbnailVersion=1`，这些是可配置起点，不当作线上测量结果。
- [ ] 浏览器生成预览优先使用 `createImageBitmap` + `OffscreenCanvas`，无该能力时使用隐藏 canvas；原图解码/预览失败保留原图并返回 `previewStatus='unavailable'`，不得让画布变成失败。
- [ ] QuotaExceededError 时保留可用的原图或远程 URL，返回可见的“已显示但未保存预览”状态；不清理旧资产来腾空间。
- [ ] 执行 `npm test -- src/services/imagePreview.test.ts`，验证比例、透明 PNG、超大图、旧 meta 版本和空间不足分支。

### Task 7: 共享读取、缓存预算和可见优先

**Files:**

- Create: `src/services/imageAssetCache.ts`
- Modify: `src/hooks/useImageAsset.ts`, `components/CanvasNode.tsx`, `components/MobileView.tsx`, `components/SettingsModal.tsx`
- Create: `src/services/imageAssetCache.test.ts`

- [ ] 以 `${assetIdentity}:${variant}:${thumbnailVersion}` 作为共享 key；同一 key 只产生一个 in-flight Promise，多个组件卸载不取消仍有消费者的请求，全部消费者离开后才 abort。
- [ ] 分离 preview/original 的内存预算：preview 采用可配置条目数和字节上限，original 采用更小的条目数、总字节和解码像素上限；可见节点优先，大图并发初始建议 1，小图并发初始建议 4，参考项目的 8/80 只作为起点。
- [ ] 失败结果不永久 memo：短暂网络失败只保留带时间戳的负缓存，重试或前台恢复可重新读取；明确 `NOT_FOUND` 才进入 missing。
- [ ] Canvas 优先 preview，Konva ready 后在需要编辑/放大/lightbox 时请求 original；variant 变化清理旧 Konva cache 并防止旧图回写。
- [ ] 执行 `npm test -- src/services/imageAssetCache.test.ts src/hooks/useImageAsset.test.tsx`，覆盖共享请求数为 1、消费者取消、preview→original、预算淘汰后可重新读取。

### Task 8: 统一所有原图消费者

**Files:**

- Modify: `src/hooks/useCanvasOperations.ts`
- Modify: `src/hooks/useImageProcessor.ts`
- Modify: `components/ContextMenu.tsx`
- Modify: `components/ImageEditPanel.tsx`
- Modify: `App.tsx`, `src/layouts/ModalsContainer.tsx`, `src/store/selectionStore.ts`
- Modify: `components/SettingsModal.tsx`, `components/MobileView.tsx`
- Modify: `src/hooks/useGenerationLogic.ts`
- Create: `src/hooks/useCanvasOperations.assets.test.tsx`

- [ ] 单张下载、批量 ZIP、自动下载、历史下载统一调用 `getOriginalBlob(assetRef)`；下载字节来自原图，不能从 preview URL 下载放大图。
- [ ] 去背景、编辑、参考图、ContextMenu view/apply、lightbox 和移动端查看统一解析 original；若 original 不可用但 preview 可用，允许查看 preview 并明确禁用需要原图的编辑/下载，提供重新读取入口。
- [ ] `useImageProcessor` 对文件导入始终保存 Blob；URL/data URL 导入也尝试保存并记录失败状态，不把 data URL 写入持久化 store。
- [ ] 去背景和替换结果创建新资产版本、同步 `assetId/thumbnailSrc/history`，旧资产交给引用清理，不复用旧 ID 造成错图。
- [ ] 执行 `npm test -- src/hooks/useCanvasOperations.assets.test.tsx`，验证原图字节一致、预览缺失回退、替换后旧资产不被读取。

### 阶段 2 验收与发布

- [ ] 真浏览器在 `/vip` 与 Canvas 两条入口分别用 4K PNG、透明 PNG、宽高比极端图验证：列表只解码预览，点击才加载原图；同一资产网络/IDB读取只发生一次，关闭大图后内存下降。Canvas 另用 50+ 节点验证视口裁剪和原图升级。
- [ ] 验证编辑蒙版、下载和批量 ZIP 的字节与原始 Blob 一致；预览生成失败时画布仍可用。
- [ ] 监控预览命中率、原图升级耗时、共享 Promise 去重率、缓存淘汰次数、IndexedDB quota 错误；异常时可配置关闭 preview 优先而不丢原图。
- [ ] 回滚到阶段 1 时忽略新增 preview/meta 键，保留原图键和持久引用；不删除新数据。

## 阶段 3：补齐本站保存、账号恢复和独立保留策略

### Task 9: 建立独立 generated asset index 与 provider

**Files:**

- Create: `generatedAssetStore.cjs`
- Create: `generatedAssetStore.mysql.cjs`
- Modify: `generatedAssetService.cjs`
- Create: `generatedAssetStore.test.cjs`

- [ ] 设计独立记录：`remote_asset_id`, `user_id`, `generation_record_id`, `task_id`, `output_index`, `original_key/url`, `preview_key/url`, `mime_type`, `width`, `height`, `bytes`, `status`, `attempts`, `created_at`, `last_accessed_at`, `expires_at`；唯一键使用 `(user_id, generation_record_id, output_index)`，不使用临时签名 URL。
- [ ] provider 抽象至少实现现有本地文件 provider，并按已有 `ali-oss`/S3 依赖和环境配置增加适配点；没有配置时明确 disabled，不伪装成已上传。
- [ ] 使用现有 `sharp` 生成服务端 preview；原图和 preview URL 明确分开。默认保留期初始建议 30 天，必须配置化并在上线前由业务确认容量/费用；不要默认永久保存。
- [ ] 设计 dry-run GC：先列候选和原因，再执行；独立资产 GC 不依赖 `generation_records` 默认成功 5 天、失败 7 天、pending 3 天的清理。
- [ ] 执行 `npm test -- generatedAssetStore.test.cjs`，验证幂等键、拥有者过滤、过期候选和 provider disabled 行为。

### Task 10: 接入可恢复保存队列和全部成功入口

**Files:**

- Create: `generatedAssetQueue.cjs`
- Modify: `server.cjs`
- Modify: `generatedAssetService.cjs`
- Create: `generatedAssetQueue.test.cjs`
- Create/modify: `server.generated-assets.test.cjs`

- [ ] 在 `persistImageResultPayloadSafe` 内把同步/异步/编辑/Gemini 的成功图片统一转换为资产任务；入口覆盖 `/api/generate`、`/api/edit`、`/api/task/:taskId`、`/api/gemini/generate` 及现有复用该 helper 的分支，视频路径保持原行为。
- [ ] 幂等键按 `userId + generationRecordId/taskId + outputIndex`；保存失败只将资产标为 pending/failed 并重试，不改变已成功的生成响应、扣点、退款和任务状态。
- [ ] 队列使用租约、指数退避、最大尝试次数、服务重启扫描；记录 `save_started/succeeded/failed` 指标和不含图片内容的错误码。
- [ ] 成功响应新增可选 `asset` 元数据（`remoteAssetId`, `previewUrl`, `originalUrl` 或恢复 endpoint），旧客户端忽略未知字段；不要把即将过期的上游签名 URL当永久地址。
- [ ] 执行 `npm test -- generatedAssetQueue.test.cjs server.generated-assets.test.cjs`，覆盖重启恢复、重复归档一次、provider 超时、生成成功但保存失败和全成功入口。

### Task 11: 认证恢复 API 与前端候选链

**Files:**

- Modify: `server.cjs`
- Modify: `services/api.ts`
- Modify: `src/services/imageAssetResolver.ts`
- Modify: `src/hooks/useImageAsset.ts`, `src/store/canvasStore.ts`, `src/store/historyStore.ts`
- Create: `server.generated-assets.auth.test.cjs`

- [ ] 新增认证接口：按当前 `X-Auth-Session` 的 `requireAuthUser` 校验账号，列表/详情/原图/预览均检查 `user_id` 拥有者；返回稳定 ID 和重新签名/代理后的短期 URL，不返回其他账号的资产。
- [ ] resolver 候选顺序变为 local original → local preview → 本站 original/preview → 仍有效的上游 URL；若本站只有 preview，画布可恢复预览并标记原图不可用。
- [ ] 账号恢复只恢复图片资产，不承诺自动同步画布几何布局；旧图若本地、本站和上游都不存在，提示用户重新导入已下载原图。
- [ ] 执行 `npm test -- server.generated-assets.auth.test.cjs`，验证不同账号隔离、云链接过期重新签名、重复 poll 不生成重复资产。

### 阶段 3 验收与发布

- [ ] 先在测试账号启用 provider 和队列，验证服务重启、数据库断开、对象存储超时后恢复；再小比例灰度开启前端本站候选。
- [ ] 观察生成成功率与保存成功率分离指标、队列积压、重试次数、本站恢复命中率、存储字节、GC dry-run 差异；保存失败不得被用户误显示为生成失败。
- [ ] 对旧的 line4 72 小时本地保存保持读取兼容；新增资产记录使用独立 TTL，不把旧文件一次性迁移或删除。
- [ ] 回滚服务端时停止新入队和恢复 API，但保留已写入云端资产；前端仍可用本地/远程旧候选，不清理新云数据。

## 跨阶段测试与执行顺序

- [ ] 每个 Task 遵循“先写失败测试 → 运行确认失败 → 最小实现 → 运行通过 → `git diff --check` → 独立提交”；执行计划时使用隔离 worktree，先保护当前工作区已有修改，不全量 `git add`。
- [ ] 每阶段完成后运行：

```powershell
npm test -- <本阶段相关测试文件>
npx tsc --noEmit
npm run build
git diff --check
```

- [ ] 在真正部署前用 Playwright/真实浏览器执行刷新恢复、标签页隐藏/前台、视口裁剪、失败重试、下载原图和不同账号恢复；浏览器隐藏时只验证回到前台后的正确终态，不宣称定时器在后台准时运行。
- [ ] 记录现有 TypeScript baseline，验收只接受“没有新增错误”；服务端 Vitest CJS 测试使用 `npm test -- <file>`，不使用 `node --test`。
- [ ] 计划执行完才进入打包/部署；本轮仅创建本文档，不修改业务代码、不清缓存、不生成修复包。

## 自审清单

- [ ] 三个阶段均有明确文件职责、数据契约、测试命令、浏览器验收、监控和回滚。
- [ ] 已覆盖无限 Loading、空/坏资源、远程与本地回退、真实 hydration、晚到 Promise、引用清理、undo/redo、预览/原图消费者和本站独立保留。
- [ ] 已覆盖 `/vip` 与 Canvas 两个不同页面入口的像素预算、重复渲染/平移、Konva cache、lightbox/download URL 释放和内存回落；没有把浏览器崩溃误归因成 IndexedDB 占用，也没有把预览图用作下载/编辑原图。
- [ ] 没有让预览代替编辑/下载原图，没有把保存失败变成生成失败，没有把本站保存建立在 5 天生成日志上。
- [ ] 所有示例接口名称和字段在前后任务间一致；初始超时、缩略图尺寸、缓存数量、30 天保留期均标注为可配置建议或待业务确认。
- [ ] 未把现有 `src/hooks/useTaskRecovery.ts` 重新启用；未触碰本轮无关的生成 polling/扣点逻辑。
