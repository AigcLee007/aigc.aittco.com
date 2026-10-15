# Nano Banana 2.1 原生图片结果修复

部署基准：`22b515f`，分支：`codex/image-async-recovery`。

## 问题和原因

Nano Banana 2.1 的原生接口可以返回 JPEG 图片编码。JPEG 的 Base64 通常以 `/9j/` 开头，旧解析器先判断 `/` 开头的值是否为本站路径，因此把这份图片编码误当成了图片网址。原生响应中的同一张图还可能分别以 data URI 和 `b64_json` 表示，导致保存流程收到两个不同的结果，其中一个无法保存。

这会出现“中转成功、本站任务成功，但图片暂存失败，画布提示本地图片缺失”的组合。WebP 的 MIME 识别及带换行、`image/jpg` 别名的结果也有相同的规范化问题。

已通过本站扣点记录把用户案例关联到任务 `job-bbc5728fd2405951209b26128d3e81ec`。未取得该任务的生产原始响应；以上原因来自相同原生接口路径的本地复现，具体旧任务是否可恢复应以修复工具读取的结果为准。

## 修改效果

- 服务端先识别图片编码，再判断是否为网址；JPEG、PNG、WebP、GIF 使用正确的 MIME。
- 同一份编码的原生结果合并为一张图，原图暂存后返回本站链接，随后发布小预览；不把大段编码作为图片网址交给画布。
- 前端 API 和 Gemini 读取使用同一个规范化函数。
- 已成功任务的图片地址修复后，画布可以恢复因持久化清理而丢失的原结果地址，同时保留用户另外编辑的本地图片。
- 沿用现有扣点、退款与保存期限；云端提示保留 4 小时，默认实际暂存 5 小时。

## 验证

原生接口回归使用本地 HTTP 中转和真实图片暂存服务，覆盖 JPEG、PNG、WebP、带换行及 MIME 别名的 JPEG。验证每次只有一份输出、原图字节一致、预览可读取、不公开图片编码、生成次数和扣点正确。

另有回归覆盖前端格式识别、旧保存流程、画布地址恢复、编辑后图片保护，以及旧任务恢复工具的幂等、账务保持、原始到期时间和更短暂存配置。

最终验证：Node 57 项、Vitest 60 项全部通过；TypeScript、恢复脚本语法检查和生产构建通过。

## 服务器更新

```bash
cd /www/wwwroot/aigc.aittco.com
git status --short
git fetch origin
git switch codex/image-async-recovery
git pull --ff-only origin codex/image-async-recovery
docker compose build app
docker compose up -d --no-deps app
docker compose ps
git log -1 --oneline
```

部署后在同一浏览器按 Ctrl+F5，不清除网站数据。使用 Nano Banana 2.1、线路一、4K 新生成一张图，检查画布显示、下载和刷新后的恢复。

## 已有任务恢复

先只读检查这次案例：

```bash
docker compose exec -T app node scripts/repair-inline-image-result.cjs --task job-bbc5728fd2405951209b26128d3e81ec
```

若返回 `eligible: true`，执行：

```bash
docker compose exec -T app node scripts/repair-inline-image-result.cjs --task job-bbc5728fd2405951209b26128d3e81ec --apply
```

工具仅恢复后台仍保存的 JPEG 编码，不重新生图、不再次扣点，不修改原始完成时间。签名链接沿用原任务完成时间计算的有效期，恢复不会延长保留时间。默认超过 5 小时、配置了更短期限且已到期、没有可用编码或任务状态不匹配时都会跳过。修复成功后由正常任务对账更新历史记录；重新加载画布可恢复地址。

工具返回不可恢复时，需使用已经下载的本地原图或中转站仍可读取的结果。更新代码本身不能找回已删除的图片。
