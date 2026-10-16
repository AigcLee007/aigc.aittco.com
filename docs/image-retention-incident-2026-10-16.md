# 图片缺失原因与长期保存修复

用户确认的保存标准：**预览和成功生成记录长期保留；云端原图继续告知保留 4 小时，实际 5 小时作为缓冲。** 自动下载与浏览器原图缓存保持独立，不把下载发起状态当成网页保存成功。

本次修复位于 `codex/image-async-recovery`，检查基准为 `c6b0963`。此文和本地验证不代表生产部署完成。

代码目录：`C:\Users\Lee Aigc\.codex\worktrees\image-async-recovery\image-zhuce`。验证产物统一保存到 `D:\image-zhuce\output\image-retention-2026-10-16`；原始事故检查报告位于 `D:\image-zhuce\output\image-recovery-2026-10-16\chrome-cache-report.json`。

## 故障结论及证据边界

这次三个入口读不到图的直接条件已经确认：临时云端原图过期，而受检浏览器中没有可用的原图或预览字节。自动下载文件仍然存在，但网页没有持续访问、关联 Downloads 文件的权限和机制。自动下载成功因此没有给网页留下一个独立的长期图片来源。

检查来自该站点数据库的隔离副本；原始检查报告为工作区 `output/image-recovery-2026-10-16/chrome-cache-report.json`。后续实验改过副本，事故原始状态以该报告为准。

| 证据 | 结果 | 支持的判断 |
| --- | --- | --- |
| 画布持久化 | 25 个节点，其中 22 个成功图片节点 | 画布布局没有整体消失，主要是图片内容缺失 |
| 画布历史持久化 | `logs: []` | 当时历史列表本身也已为空 |
| 共享结果库 | 35 份结果元信息，42 份来源索引，没有原图、预览和素材元数据键 | 有结果身份不等于存在图片字节 |
| 经典版库 | 35 份记录，原图 0、预览 0 | 画廊列表记录与图片内容没有共同持久保障 |
| 下载目录 | 多份对应时间的原图确实存在 | 下载文件与网页数据库是两条保存链路 |
| 线上脚本 | 共享结果库、经典结果资产、桥接和页面脚本均与 `c6b0963` 一致 | 此次不属于简单的“旧版本没部署” |

**尚未确定的事实：谁、在哪个时刻、通过什么操作让这台浏览器的图片字节变空。** 现有日志没有足够的缓存删除审计。数据写入失败、旧版本操作、外部清理等仍缺乏可归因证据。以下确定的代码缺陷和保存规则不等于已经证明这次缓存删除事件的唯一原因。

## 已证实的系统问题

1. **原图和预览共用到期期限。** 异步资产预览原来和原图使用相同过期签名，清理也删除两者；第四线路的缩略图同样参与原图到期清理。因此本地图片丢失后，服务器也没有长期预览兜底。
2. **记录的保存期限与用户预期不同。** MySQL 原规则自动删除超过 5 天的成功记录；文件实现把所有用户的记录整体截到 10,000 条。画布历史只读本地最多 50 条记录，未从账号记录读取；页面还隐藏部分超过 72 小时的第四线路记录。这些是已查明的未来丢记录路径，不能据此认定它们导致了本次全部现象。
3. **历史整理将图片不可用等同于记录无效。** 已用回归测试复现：只带 data/blob 临时地址、尚未拿到持久素材 ID 的历史记录，在整理和刷新时被整条过滤，提示词、时间也随之消失。经典版也跳过没有原图地址的成功记录。
4. **图片正文被写成数据库键。** 原始报告存在 13,792,525 字符长的 `result-source-*` 键，内容是 URL 编码后的 JPEG Base64。该站点 LevelDB 目录约 1.17 GB，清单文件单独为 1,020,905,517 字节。原注册逻辑把 `/9j/...` 误识别成相对 URL。异常长键会加重数据库元数据压力，但目前没有证据证明它独自造成全部图片字节缺失。
5. **历史里存在被截断的图片地址。** 部分地址是 2047 字符并以 `[truncated]` 结束，包含被截断的内联图片；它们不是可重新读取的图片来源。

## 修复后的保存链路

- 异步预览使用独立、绑定账号/任务/文件名的签名能力地址；它不随原图过期。预览签名不能读取原图或其他账号的文件。旧的有效预览签名继续兼容。
- 清理只删除到期原图，保留已写入的预览；第四线路保留缩略图。签名密钥和预览均存放在已有持久化卷中，服务重启继续使用相同地址。
- 内联/本站原图在返回保存结果前完成预览制作；远程原图仍在后台保存，预览发布沿用任务资产更新日志。多输出尚有预览未完成时保持保存中状态，以便重启续存；预览写入失败重试一次，最终失败明确记录保存失败和日志，并保留已经成功的原图。生成成功与保存故障继续分开结算，预览故障不会触发重复生成或退款。
- 每个输出分别保存并发布预览数组，经任务日志、账号记录 `meta.previewUrls` 传到画布和画廊，不把第一张的预览用于全部输出。
- MySQL 成功图片记录不再参与定时到期删除；其他成功媒体以及失败、待处理记录沿用原规则。文件实现不再因全局数量上限丢弃成功图片记录，读取异常时保留原文件并报错。
- 画布历史读取当前账号的服务器记录，并可分页加载更早的记录；本地记录作为补充。网络读取失败保留已显示记录，账号切换丢弃迟到响应。明确执行清空后才删除账号历史。
- 画布现存节点缺少长期预览时，按明确的账号/任务/输出索引批量查询成功记录补齐，超过接口单批 100 个任务时分批查询。它不重建布局，不按提示词配对，也不覆盖本地编辑后的图片。因此关页后才完成保存的结果，不再依赖短期任务元数据仍然存在。
- 图片地址或字节不可用时，历史仍保留记录身份、提示词和时间。移除 72 小时的页面隐藏规则。
- 来源索引拒绝原始 JPEG Base64、截断地址和异常长地址。升级时只移除超大/截断的来源索引键，不清空图片、节点、历史或记录。删除索引不代表 LevelDB 清单会立即缩小；不能通过清空站点数据库来强制整理。

## 验证

回归覆盖原图配额/事务失败、下次打开和原图到期、双标签下载意图、跨账号迟到响应、编辑素材保护、多输出预览、原图/预览签名隔离、物理清理与重启、文件读异常、记录数量上限和按任务批量查询。

最初相关回归：Node 后台、接口和经典版 **139/139** 通过；Vitest 前端和本地存储 **98/98** 通过，包括 105 个画布任务跨批补齐预览。日志分别为工作区 `output/image-retention-2026-10-16/node-tests-release.log` 和 `vitest-release.log`。推送前重新执行以上 237 项，全部通过，日志为同目录 `node-tests-push.log` 和 `vitest-push.log`。

推送前只读审查另发现：多输出最后一张预览失败时，失败分支未发布最终状态，旧的部分完成更新会使任务停留在保存中。新增组合回归已在修改前复现 `pending` 与预期 `failed` 不符；失败分支现同样发布最终状态，保留已保存的原图和其他预览，不改变生成结算。

修正后 Node 全部相关回归 **140/140** 通过（`node-tests-push-final.log`），结合前端 **98/98**，最终共 **238 项通过**。此后产品变更仅涉及后端失败分支通知，不改变已经验收的前端构建内容。

最终 `npx tsc --noEmit`、`npm run build` 均退出 0；构建脚本为 `dist/assets/index-BdSc3GiP.js`。并行运行类型检查与构建时曾因本机内存分配失败中断构建，待类型检查结束后单独构建通过，未因此改动产品代码或构建配置。保留的构建提示为浏览器兼容数据较旧、动态/静态混合导入以及大文件提示。

扩大测试期间，后台原有测试曾出现超时和状态时序不稳定；使用修改前 `HEAD` 的任务服务作对照，也复现了原有期限/发布重试测试失败。最终回归在独立测试目录、单并发条件下通过；这不表示已经修复所有旧测试的时序不稳定问题。

真实 Chrome 验证已在上述最终构建上重跑，使用隔离账号 API fixture 和真实预览文件：模拟 365 天后，执行原图物理清理、重建资产服务，再分别打开两个全新浏览器上下文。两个上下文都没有原图/预览缓存或本地历史，账号历史仍显示预览；原图请求返回 410，预览返回 200，页面错误 0。该测试不使用生产账号、不修改实际浏览器数据、不消耗生图额度。截图和结果在工作区 `output/image-retention-2026-10-16/`。

具体命令：

```powershell
node --test --test-concurrency=1 imageJobService.test.cjs imageJobAssets.test.cjs imageHistoryRetention.test.cjs server.image-jobs.test.cjs public/classic-app/result-assets.test.cjs public/classic-app/gallery-stability.test.cjs public/classic-app/image-runtime.test.cjs public/classic-app/image-memory.test.cjs
npm test -- src/services/imageResultStore.test.ts src/services/imageAssets.test.ts src/services/localCacheMaintenance.assets.test.ts src/services/localCacheMaintenance.sources.test.ts src/services/canvasResultIdentity.test.ts src/services/canvasHistoryPreviews.test.ts src/hooks/useImageAsset.test.tsx src/hooks/useAccountGenerationHistory.test.tsx src/store/historyStore.test.ts generatedAssetService.test.ts src/hooks/useGlobalPolling.recovery.test.tsx src/hooks/useGlobalPolling.jobs.test.tsx
npx tsc --noEmit
npm run build
git diff --check
```

## 上线和运行要求

沿用现有服务器目录和 Docker Compose 部署方式，执行以下命令同时更新前后端。先完成镜像构建，构建成功后再替换应用容器；不重建 MySQL。

```bash
set -e
cd /www/wwwroot/aigc.aittco.com
git fetch origin
git switch codex/image-async-recovery
git pull --ff-only origin codex/image-async-recovery
git log -1 --oneline
docker compose build app
docker compose up -d --no-deps app
docker compose ps
docker compose logs --tail=100 app
```

这次不需要执行数据库迁移，也不需要清空浏览器缓存。更新时保留 `.env`、MySQL 数据卷和现有 `storage` 目录；不要执行 `docker compose down -v`。更新后页面上的保存提示应为“原图云端仅保留4小时，请尽快下载到本地；预览和生成记录长期保留。”

前端与后端应一起发布。保留现有 MySQL 数据、`storage/image-jobs`（含签名密钥和预览）、`storage/line4` 卷。现有 Docker Compose 已挂载这两处资产目录；不需要修改原图 TTL，也不需要清空数据库或浏览器缓存。成功图片记录的新策略不再受原来的成功记录天数配置影响，其他媒体仍沿用该配置。

长期预览会持续占用磁盘。数据库与上述两个目录须纳入同一备份/恢复流程，并监控磁盘剩余空间、预览写入失败日志。只备份 Git 仓库不能保存用户预览。日志事件 `Image preview save failed` 包含任务 ID 和错误原因，不记录图片正文。

发布验收用新生成的多输出任务检查：每个输出有不同的正确预览，退出页面后仍完成保存，重新登录或清空图片缓存后仍从账号记录显示预览，超过原图期限只让原图下载失效。浏览器保存的原图及用户下载文件仍由浏览器/用户管理。

本次不对已经被历史清理删除的服务器文件和记录作补回承诺。已缺失的旧字节也不能通过发布新代码重新产生。这里落实的是所有用户后续使用的长期保存链路，而不是对单个画布做一次性恢复。
