# GPT-Image-2.6-Sunburst

模型 ID：`gpt-image-2.6-sunburst`。唯一线路为“原生线路”，线路 ID 为 `gpt-image-2.6-sunburst-native`。

- 生成接口：`https://rolldek.com/v1/images/generations`。
- 编辑沿用 2.5 的 `/v1/images/edits` 和 multipart 参数。
- 质量：`low`、`medium`、`high`；默认 `medium`。旧设置中的 `auto`、`xhigh`、`max` 会回退到 `medium`。
- 1K：4 分/张；2K：4.5 分/张；4K：5 分/张。默认 2K。
- 三个尺寸均发送同一个上游模型名，像素转换及约束沿用 2.5。

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

4. 刷新页面，确认画布版和经典版显示新模型、唯一原生线路及三档质量。

已有数据库的模型和线路以数据库为准，修改 JSON 不会自动新增条目。脚本只创建缺失的模型和线路；重复运行不会覆盖管理员修改的价格、启停状态或密钥配置，中途失败后可重新运行。新数据库首次初始化时会直接导入静态配置。

## 验证

```sh
npx vitest run src/config/gptImage26.test.ts src/config/imageModels.test.ts imageModelCompatibility.test.cjs imageRouteCompatibility.test.cjs components/ImageFormConfig.test.tsx scripts/activate-gpt-image-2-6-sunburst.test.cjs --maxWorkers=1
node --test server.gpt-image-26.node.cjs productionImageRouteConfig.test.cjs imageRouteResolution.test.cjs imageCatalogInitialization.test.cjs
npm run build
```

HTTP 集成测试使用本地上游，验证生成请求格式、质量和实际积分扣除；不会调用 RollDek 的付费接口。真实上游生成与编辑需在部署密钥生效后验证。
