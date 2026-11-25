# Midjourney v8.2

站内模型 ID 为 `midjourney-v8.2-tehui`。新任务使用默认稳定线路 `midjourney-v8.2-osodm-wending`。`midjourney-v8.2-osodm-tehui` 已停用，保留旧线路记录和 Key 供已提交任务查询。

- 上游使用 `Midjourney-全系列`，请求传 `version: "8.2"` 和 `n: 1`。
- 提交使用 `POST /v1/images/midjourney/generations`，轮询使用 `GET /v1/images/midjourney/tasks/{taskId}`，同一任务沿用提交时的线路 Key。
- 每组出四张图，售价 16 金币。两组发起两次提交，出八张图，共 32 金币。失败继续走站内退款流程。
- 工作台提供标准画质、十种画面比例和一张可选参考图。2K 和旧质量档位待上游确认后开放。

[上游接口文档](https://api.osodm.com/docs/model/Midjourney-%E5%85%A8%E7%B3%BB%E5%88%97)

## 部署

现有稳定线路继续使用 `Midjourney-v8.2-osodm-wending` 所配置的 Midjourney 分组 Key。部署后应用启动时会同步 MySQL 目录。同步只修改 Midjourney 模型和两条线路，保留已有 Key、旧任务和历史账单。

如需手动查看迁移状态，在新版本容器运行以下命令。加 `--apply` 可重复执行同步。

```sh
docker compose exec -T app node scripts/activate-midjourney-v82-tehui.cjs
```

上线核对线路目录只显示稳定线路且价格为 16 金币，再通过站内测试账户验证一组生成和扣费。
