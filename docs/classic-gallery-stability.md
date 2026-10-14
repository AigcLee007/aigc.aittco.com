# 经典版画廊稳定性与原图保存

本次在 `codex/image-async-recovery` 分支实施，实现提交为 `dc7de1d`，前一部署基准为 `501de9c`。覆盖经典版、VIP 的生成记录与画廊，并让同账号同任务的原图、预览和自动下载意图与画布共用。服务器异步受理、扣点及退款接口沿用已经发布的版本。

## 更新后的效果

- 图片按首次提交时间排列。查询、生成完成、本站链接和预览补齐只更新对应卡片，不把之前的图片反复移到上下位置。
- 打开画廊先读当前账号的本地记录，后台核对服务器。核对失败保留已有图片；认证接口暂时断开时，当前会话对应的已确认账号仍可读取本地记录，付费生成继续要求服务器认证。
- 桌面每页 24 张，手机每页 12 张，只读取可见预览。原图缓存和下载逐张处理；图片列表不需要常驻解码所有原图。
- 新结果即使画廊关闭也排队缓存原图，经典版新增默认开启的自动下载开关，与画布共用设置。恢复、刷新和两个标签页不会反复自动发起同一结果下载。
- 区分“原图已缓存（本浏览器）”“仅预览已缓存”“云端暂存”“缓存空间不足”“原图已过期”和“已发起下载”。浏览器发起下载不能证明文件已经保存，请核对下载记录。
- 图片读取失败只重试该图，不重新扣点生成。支持“从本地恢复”选回下载过的原图，重新制作预览。原图先提交缓存，预览制作失败也不会丢弃原图。
- 多输出逐张保存；上游临时链接换成本站链接时继续使用同一资产身份。已成功但仍在保存的任务继续有限查询，不重复结算生成计数。

浏览器缓存与系统下载文件各自独立。页面保留云端 4 小时提醒，服务器实际 5 小时缓冲；这两个期限不清理用户下载文件或浏览器原图。无法确认归属的旧记录保留原有记录和 Blob，不按提示词猜测账号或任务。

## 本地验证

本次使用模拟接口，不消耗线上生图额度。实际 Chrome 页面与 IndexedDB 验证了以下场景：

- 100 条包含 3840×2160 PNG 原图及 720×405 WebP 预览的记录：桌面 24 张/页、手机 12 张/页。桌面首屏读取 8 张预览、0 张原图，解码峰值 1。
- 三次往返翻页后活动 Object URL 和峰值均为 8，没有持续累积。模拟图片使用简单图案，本测试验证列表读取与资源释放，不代表全部设备上的内存压力测试。
- 历史接口延迟 2.5 秒后返回 503：24 张已有卡片继续显示，旧卡片身份不变、移除次数 0、新预览读取次数 0。
- 新任务更新状态时，旧成功卡片保持连接及位置。
- 两个实际标签页同时恢复同一结果，仅发起一次自动下载，两个页面共用持久化下载意图。
- 认证接口断开后重新加载前端页面，原会话的本地画廊继续显示并读取预览。测试要求前端 HTML/脚本本身可访问；此次未增加离线网页安装或 Service Worker。
- 过期图片通过实际文件选择器恢复；随后手动下载的文件与选入文件 SHA256 相同，状态为“已发起下载”。

回归测试覆盖原图事务失败、配额不足、缓存暂不可读、双标签下载领取、跨标签账号切换、预览损坏修复、旧 Blob 明确迁移、多输出、延迟保存和本地历史并发写入。原图暂时读取失败时，后续任务恢复补做缓存及下载；退避限制重复尝试，图片过期或原图缓存配额不足时停止自动重试。Node 98 项、Vitest 53 项测试通过，TypeScript、脚本语法及生产构建通过。独立规格、运行时、共享存储与经典版质量审查通过。

测试命令（Windows 下显式列出文件）：

```powershell
node --test classicImageJobs.test.cjs public/classic-app/image-runtime.test.cjs public/classic-app/image-memory.test.cjs public/classic-app/gallery-stability.test.cjs public/classic-app/result-assets.test.cjs
npm test -- classicModelCatalog.test.cjs src/services/imageAssets.test.ts src/services/imageMemoryBudget.test.ts src/services/imageJobClient.test.ts src/services/imageResultStore.test.ts src/services/canvasResultIdentity.test.ts src/services/imageAutoDownloadPreference.test.ts
npx tsc --noEmit
npm run build -- --outDir D:/image-async-recovery-build
git diff --check
```

## 服务器更新与验收

```bash
cd /www/wwwroot/aigc.aittco.com
git status --short
git fetch origin
git switch codex/image-async-recovery
git pull --ff-only origin codex/image-async-recovery
docker compose up -d --build app
docker compose ps
docker compose logs --tail=100 app
git log -1 --oneline
```

保留现有 `.env`、数据库、`uploads`、`storage`。本次不需要数据库迁移或改变保留期限。服务器有本地 Git 修改时先核对保存，不要强制重置。部署后 Ctrl+F5 加载新脚本，经典脚本版本参数为 `classic_gallery_v2`。

1. 同时生成两张图，切到其他标签再回来：旧图不乱跳，每个输出均保留。
2. 关闭画廊完成生成，打开浏览器下载记录核对原图；关闭自动下载后，新图仍缓存但不自动下载。
3. 打开画廊，切换页面并刷新：先读本地预览。开发者工具将 API 请求设为失败时，已有图继续显示。
4. 用一张过期或缓存被清理的记录测试“从本地恢复”，再下载原图；重试读取不能触发生图扣点。
5. 两个标签页登录同一账号恢复同一新结果：只自动发起一次下载。浏览器拦截批量下载时使用手动下载入口。
6. 账号切换后，不显示前账号的图片；切回原账号恢复其记录。

本地验证不能代替线上中转线路、实际低内存用户设备及浏览器下载限制验收。原先已存在的画布批量 ZIP 下载仍会汇总选中原图；此次控制了经典列表及共享缓存/自动下载路径，未重写 ZIP 打包机制。
