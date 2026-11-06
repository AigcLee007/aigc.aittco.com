# GPT-Image-2.6-Sunburst

模型 ID 为 `gpt-image-2.6-sunburst`。RollDek 原生线路是默认线路，线路 ID 为 `gpt-image-2.6-sunburst-native`。

- 生成接口：`https://rolldek.com/v1/images/generations`。
- 编辑沿用 2.5 的 `/v1/images/edits` 和 multipart 参数。
- 质量：`low`、`medium`、`high`；默认 `medium`。旧设置中的 `auto`、`xhigh`、`max` 会回退到 `medium`。
- 1K：4 分/张；2K：4.5 分/张；4K：5 分/张。默认 2K。
- 三个尺寸均发送同一个上游模型名，像素转换及约束沿用 2.5。

MochiAI「特价4K」线路 ID 为 `gpt-image-2.6-sunburst-mochiai`，同步调用 `https://mochiai.art/v1/images/generations` 和 `/v1/images/edits`。支持 `low`、`medium`、`high`、`xhigh`、`max`，默认 `medium`。1K、2K、4K 分别为 2、2.5、3 金币/张。

## 部署到已有 MySQL 环境

1. 在部署环境 `.env` 中设置 `GPT-image-2.6-sunburst_rolldek_yuansheng` 为实际密钥，然后按现有流程构建并重建 app 容器，让新代码、配置和环境变量生效。
2. 预览增量导入：

   ```sh
   docker compose exec app node scripts/activate-gpt-image-2-6-sunburst.cjs
   ```

3. 执行导入：

   ```sh
   docker compose exec app node scripts/activate-gpt-image-2-6-sunburst.cjs --apply
   ```

4. 刷新页面，确认画布版和经典版显示原生线路及三档质量。

启用「特价4K」时，在服务器 `.env` 设置 `GPT-image-2.6-sunburst_mochiai` 后重建 app 容器。应用启动时会自动补录这条线路。需要手动补录时运行：

```sh
docker compose exec -T app node scripts/activate-gpt-image-2-6-sunburst.cjs --mochiai --apply
```

增量导入保留已有模型和线路的管理员设置。新数据库首次初始化时会导入静态配置。

## 验证

```sh
npx vitest run src/config/gptImage26.test.ts src/config/imageModels.test.ts imageModelCompatibility.test.cjs imageRouteCompatibility.test.cjs components/ImageFormConfig.test.tsx scripts/activate-gpt-image-2-6-sunburst.test.cjs --maxWorkers=1
node --test server.gpt-image-26.node.cjs productionImageRouteConfig.test.cjs imageRouteResolution.test.cjs imageCatalogInitialization.test.cjs
npm run build
```

HTTP 集成测试使用本地模拟上游验证两条线路的生成请求格式、质量和积分扣除。真实上游生成与编辑需在部署密钥生效后验证。
