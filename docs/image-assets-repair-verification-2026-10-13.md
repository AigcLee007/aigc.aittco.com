# 图片 Loading 与内存修复记录

本轮已修改本地代码，覆盖 VIP 创作页和画布页的图片读取、本地恢复与图片内存生命周期。尚未部署到 aigc.aittco.com；第三阶段“本站保存、跨设备恢复”暂缓。

## 用户能看到的变化

| 场景 | 修复后的行为 |
| --- | --- |
| 图片读不到、链接失效、解码失败 | 显示具体读取失败或缺失状态，提供“重新读取图片”；读取有截止时间，不会永久 Loading。重试只读取图片，不重新生成、扣点。 |
| 远程链接失效，但本地还有原图 | 优先使用已有本地原图和预览缓存；兼容旧的 IndexedDB 图片记录。 |
| 页面一直开着，其他任务刷新或图片离开视野 | 成功图片保持稳定；离开视野释放显示资源，回来重新读取。旧请求的晚到结果不能覆盖新图片。 |
| 本地缓存暂时不可读 | 保留原有持久记录，提供恢复入口；恢复时保留期间新增、删除、编辑、生成完成的内容。健康的其他存储仍可保存。 |
| 画布或 VIP 有很多大图 | 日常展示最长边 720px 预览；查看大图、编辑、下载时按需读取原图，关闭后释放。 |
| 下载和使用参考图 | 使用原始图片字节，预览图不会替代下载原图。 |

## 实施范围

- `imageAssetCache` 统一候选恢复、共享读取、有限等待和引用计数；`useImageAsset` 处理组件生命周期、重新读取及旧结果丢弃。计划中的独立 resolver/runtime 职责合并在这两处。
- 原图沿用 `asset-{id}`，增加独立 preview/meta/source 映射键；先保存原图，预览生成或持久化失败仍保留原图。缓存满时，可使用已经生成的小预览。
- Canvas、移动端、历史、参考图和大图查看使用统一资源读取；关闭额外的 Konva 图片场景缓存。画布默认不常驻解码原图。
- 后台缓存的下载到持久提交最多并发 3；本地预览从读取原图到解码、保存最多并发 1；导入文件顺序处理，避免排队时保留大量原图。
- 画布原图解码租约按像素估算，预算 96MiB；闲置预览最多 64 项/32MiB。VIP 预览准备和解码均并发 1，闲置预览最多 12 项/8MiB，关闭大图或最后一个消费者释放时清理原图 URL。
- 缓存清理保护画布、图片历史、参考图、undo/redo 两栈和读取中的资产，也保护只有 URL 的旧记录。未知旧资产保守保留，新资产具有 7 天宽限。
- 图片修复独立提交在 `codex/image-assets-recovery`。之前的生成请求超时改动保留在本地工作区；本次提交不包含服务端提交、上游轮询、扣点或计费改动，也没有制作修复包。

## 验证结果

2026-10-13 对 Git 暂存区导出的独立图片修复版本执行：React/服务回归 **41/41**，VIP 图片回归 **30/30**，共 **71 项通过**；生产构建、类型检查和 `git diff --cached --check` 通过。提交范围拆分后再次通过 19 项持久化回归和生产构建。之前含未提交请求超时改动的完整工作区回归为 82 项通过，这些超时改动不属于本次提交。

回归覆盖：本地旧缓存优先、损坏原图及 source 映射恢复、恢复后二次离线读取、原图字节、同资产不同入口共享及恢复候选合并、共享取消、读超时及重试、缓存满仍显示预览、慢持久写入的内存并发、恢复期间修改与生成完成、恢复成功回调间隙的最新状态落盘、清理和 undo/redo 引用。

| 真实 Chrome 浏览器验收 | 结果 |
| --- | --- |
| 画布 50 张 3840×2160 PNG | 50 个可见资源均为 720×405 预览；原图常驻租约为 0，预览像素约 55.62MiB。 |
| 刷新与失效远程地址 | 50 张恢复；恢复过程访问失效远程地址 0 次。 |
| 20 次打开/关闭原图并移出/移回画布 | 每轮关闭后原图租约回到 0，资源数量与预览像素没有增长。 |
| 原图校验 | 下载读取与原始 PNG 的 SHA-256 完全一致。 |
| 缺失资源及失败任务 | missing/empty 均结束读取；生成失败状态持久化保留。 |
| VIP 4096×2048 旧缓存 | 恢复为 720×360 预览；原图 166233 字节保持一致。 |
| VIP 卡片与滚动 | 其他任务更新保持成功卡片/图片；滚出释放、滚回恢复；快速滚出再滚回丢弃旧结果。 |
| VIP 大图关闭和失败重试 | 清空大图 src 并 revoke 原图 URL；缺失资源显示读取失败和重试入口。 |

浏览器验收在独立本地页面执行，后台 API 使用失败响应隔离，没有提交真实生成任务。Chrome JavaScript 堆在循环结束并主动 GC 后下降；该数值不代表整个浏览器进程或 GPU 内存。未实施低端设备的长时间压力测试，超大 BMP/SVG/AVIF 等未知尺寸格式还需要另行补充防护，不能据此承诺所有浏览器绝不会 OOM。

独立提交导出目录的 `npx tsc --noEmit` 已通过。原工作区的全量类型检查仍因既有 `storage/patches/generation-timeout-fix-2026-10-12` 备份文件的缺失模块/隐式类型失败；没有修改或删除该备份来掩盖基线。

## 复验与证据

```powershell
npm test -- src/services/imageAssets.test.ts src/services/imageMemoryBudget.test.ts src/hooks/useImageAsset.test.tsx src/services/localCacheMaintenance.assets.test.ts src/services/localCacheMaintenance.sources.test.ts services/api.test.ts --exclude '.worktrees/**'
node --test public/classic-app/image-memory.test.cjs public/classic-app/image-runtime.test.cjs
npm run build
npx tsc --noEmit
git diff --check
```

- 以下 `output/playwright` 浏览器脚本、结果和截图作为本地验证证据保留，没有随提交公开上传。
- 画布脚本：`output/playwright/canvas-assets-browser.cjs`。
- 画布结果：`output/playwright/canvas-assets-browser-verification.json`，截图 `output/playwright/canvas-50-images-final.png`。
- VIP 夹具：`scripts/image-asset-browser-fixture.cjs`，仅在独立测试页面运行，不作为公开静态资源发布。
- VIP 结果：`output/playwright/classic-assets-browser-verification-final.json`。

上线后才可以验证真实用户环境的改善；本站保存、跨设备恢复、生产监控与灰度发布不在本轮交付内。
