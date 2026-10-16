# 生图等待超时：上线和诊断

本地修复范围：浏览器请求和响应体超时、独立的查询总期限、成功无图片处理、画布图片的阶段/耗时显示、编辑结果的后台持久化。不能由此断言线上上游服务已恢复；仍需查原任务和上线后受影响用户的响应。

## 先核对原任务

服务器项目目录：`/www/wwwroot/aigc.aittco.com`。新诊断脚本需与源码一起上传。下面查询只读取数据库，不重新提交生图、不轮询上游、不改余额。

```sh
cd /www/wwwroot/aigc.aittco.com
docker compose cp scripts/diagnose-image-task.cjs app:/app/scripts/diagnose-image-task.cjs
docker compose exec -T app node scripts/diagnose-image-task.cjs chg_ba8a46c1e82123913005
```

这笔扣点时间是 2026-10-12 21:50:41（北京时间，UTC 13:50:41）。

- 有 `task_id` 且 `status=SUCCESS`：后端任务已成功结算，继续检查浏览器 `/api/task/<task_id>` 是否返回图片。
- `status=FAILED`：核对服务器该时段的上游错误，再核对退款。
- `status=PENDING`：后端仍在处理或没有完成结算，核对进程和上游等待日志。
- 有扣点、没有 task 行：请求已进入计费，但还不能证明成功登记任务，重点查扣点之后的日志。
- 历史编辑任务可能没有 generation record；新修复只为后续任务补齐记录。

可以在服务器查看相应时段日志：

```sh
docker compose logs --since '2026-10-12T13:49:00Z' --until '2026-10-12T14:25:00Z' --timestamps app
```

重点关注 `GPT-image-2 Sync Background Edit Error`、`Edit`、超时及任务结算。日志可能包含提示词或上游图片链接；提供诊断脚本的摘要输出即可，不需要提交密钥或整份日志。

## 部署

上传本次修改的源码和诊断脚本，沿用现有部署流程。先确认没有正在处理的任务；本项目本地后台 job 仍使用进程内存，重启会中断正在运行的 job。

```sh
cd /www/wwwroot/aigc.aittco.com
docker compose up -d --build app
docker compose ps
docker compose logs --tail=60 app
```

不得用本地 `.env`、数据库 JSON 或上传目录覆盖服务器数据。Dockerfile 会构建 React 和 classic 静态文件；经典脚本的 URL 版本已更新，用户重新打开页面即可加载新脚本。

## 验证

用受影响浏览器同样的账号、模型和参考图做一次受控验证：提交后应收到任务 ID，页面显示“任务已受理，等待结果”；图片完成后刷新仍能在经典版画廊看到记录。查询无响应会结束本地等待并提示结果未确认，不会自动重提。

如果原任务已成功，先让用户刷新历史恢复结果；原任务确认失败且未退款，再按实际任务记录核对补偿。不要因为页面 98% 直接重试或批量退款。

若仍只有部分网络用户异常，需要同一时段的 Nginx access/error 日志及浏览器请求状态，判断请求上传、反向代理、查询响应或图片加载哪一段中断。Ping 和扣点成功率无法验证这些环节。
