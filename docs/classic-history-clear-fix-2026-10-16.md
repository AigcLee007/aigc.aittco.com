# 经典版确认清空后历史回填修复

## 原因

经典版桥接层沿用旧的本地清空函数，只删除浏览器记录，没有调用现有的账号历史删除接口，也没有重置服务器历史缓存。随后的历史加载会把记录重新写回，因此确认清空后列表仍然存在。

此外，近期已完成任务的恢复会直接读取任务收据重新保存历史；清空前发出的历史请求、普通任务查询和预览补存查询，也可能在清空后返回并再次写入。这些路径已用回归测试复现，不涉及用户原图自动下载是否成功。

## 修改

- 登录状态下，确认后先调用当前账号的 `DELETE /api/generation-records?mediaType=image`，成功后清空当前账号的本地记录、远程列表缓存与分页状态。取消不发送请求；服务端删除失败保留列表并显示错误。
- 历史请求和数据库写入检查账号、会话与清空版本，避免迟到写入或账号切换影响其他账号。
- 已完成任务恢复前按任务 ID 核对账号历史；已删除的记录不能仅凭短期任务收据重建。
- 普通查询、预览补存和恢复流程在异步边界检查清空版本。过期响应不写历史，也不启动新的补存轮询。未完成任务继续查询，清空后的新查询仍可保存后续结果，任务界面结算保持正常。
- 确认文案说明账号图片历史与画布共用，清空不删除已下载文件或本地原图缓存。静态脚本版本号同步更新。

本次修复针对当前页面的账号历史清空和刷新回填；不新增其他已打开页面的即时同步机制，不操作生产账号数据。

## 验证

经典版相关回归 **103/103 通过**，覆盖取消、删除失败、账号切换、迟到历史响应、等待数据库打开的失效写入、任务恢复、普通查询与清空并发，以及未完成任务继续保存。

```powershell
node --test --test-concurrency=1 public/classic-app/gallery-stability.test.cjs public/classic-app/result-assets.test.cjs public/classic-app/image-runtime.test.cjs public/classic-app/image-memory.test.cjs
npm run build
node --check public/classic-app/script.js
node --check public/classic-app/unified-bridge.js
git diff --check
```

真实 Chrome 使用构建后的经典版页面与隔离账号 API 验证：取消没有删除请求；模拟删除失败仍有两条记录；确认成功后为零；清空前发出的成功任务响应返回、任务恢复和页面刷新后仍为零；页面错误为零。测试未使用生产账号。

本地测试和构建日志：`D:\image-zhuce\output\image-retention-2026-10-16\classic-clear-tests-final.log`、`classic-clear-build-final.log`。浏览器结果及截图：`D:\image-zhuce\output\playwright\classic-clear-history\result.json`、`cleared-after-reload.png`。

## 更新

GitHub 分支：`codex/image-async-recovery`。服务器沿用现有 Docker Compose 部署：

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

更新后刷新经典版页面，使用测试账号验收清空后刷新仍为空。本次不需要数据库迁移。
