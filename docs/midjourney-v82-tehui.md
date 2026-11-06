# Midjourney v8.2

模型 ID 为 `midjourney-v8.2-tehui`。默认特惠线路的 ID 为 `midjourney-v8.2-osodm-tehui`。

- 上游模型：`Midjourney v8.2-特惠`，域名 `https://api.osodm.com`。
- 异步提交：`POST /v1/images/midjourney/generations`。
- 查询：`GET /v1/images/midjourney/tasks/{taskId}`，与提交使用同一个 Key。
- 计费：每组四张，每张 2 金币，每组 8 金币；标准、2K、各档质量统一价格。
- 数量选择器表示组数：1 组为 4 张/8 金币，2 组为 8 张/16 金币。
- 质量为字符串 `0.25`、`0.5`、`1`、`2`，默认 `1`。1K 选项对应上游默认标准档；2K 对应 `hd=true`。
- 十种比例：1:1、3:2、2:3、4:3、3:4、5:4、4:5、16:9、9:16、21:9。
- 最多一张参考图，支持 URL 或图片 data URL。通过生成接口传参考图，不加入局部编辑模型列表。
- 上游 `n` 固定为 1；读取全部四张结果，排除四宫格预览，失败任务沿用原有退款流程。

稳定线路的 ID 为 `midjourney-v8.2-osodm-wending`，上游模型为 `mj-v8.2`。复用上面的异步提交和查询接口及站内生成选项，价格为每张 4 金币、每组 16 金币。[OSODM 稳定版文档](https://api.osodm.com/docs/model/mj-v8.2)

## 部署

在服务器 `.env` 设置 `Midjourney-v8.2-osodm-tehui`。上游要求该 API Key 属于 **Midjourney 分组**。

按现有流程更新构建并重建 app 容器后，已有数据库执行增量导入：

```sh
docker compose exec -T app node scripts/activate-midjourney-v82-tehui.cjs
docker compose exec -T app node scripts/activate-midjourney-v82-tehui.cjs --apply
```

第一条预览，第二条执行。脚本可重复执行，只新增缺失模型和线路，不覆盖管理员已设置的价格、密钥与启停状态。空数据库首次初始化会读取静态目录。

启用稳定线路时，在服务器 `.env` 设置 `Midjourney-v8.2-osodm-wending` 并重建 app 容器，应用启动时会自动补录。也可手动补录：

```sh
docker compose exec -T app node scripts/activate-midjourney-v82-tehui.cjs --stable --apply
```

## 验证

```sh
npx vitest run midjourneyImagePolicy.test.cjs src/config/midjourney.test.ts components/ImageFormConfig.test.tsx scripts/activate-midjourney-v82-tehui.test.cjs --maxWorkers=1
node --test server.midjourney.node.cjs productionImageRouteConfig.test.cjs
npm run build
```

HTTP 测试使用本地模拟上游，覆盖四张结果、2K、质量、单张参考图、每组扣费、失败退款与非法请求拦截，不调用真实付费接口。

来源：[上游文档](https://api.osodm.com/docs/model/Midjourney%20v8.2-%E7%89%B9%E6%83%A0)，2026-11-05 读取。
