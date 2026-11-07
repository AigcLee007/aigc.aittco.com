# GPT-Image-2.6-Sunburst

模型 ID 为 `gpt-image-2.6-sunburst`。RollDek 原生线路是默认线路，线路 ID 为 `gpt-image-2.6-sunburst-native`。

- 生成接口：`https://rolldek.com/v1/images/generations`。
- 编辑沿用 2.5 的 `/v1/images/edits` 和 multipart 参数。
- 质量：`low`、`medium`、`high`；默认 `medium`。旧设置中的 `auto`、`xhigh`、`max` 会回退到 `medium`。
- 1K：4 分/张；2K：4.5 分/张；4K：5 分/张。默认 2K。
- 三个尺寸均发送同一个上游模型名，像素转换及约束沿用 2.5。

MochiAI「特价4K」线路 ID 为 `gpt-image-2.6-sunburst-mochiai`，同步调用 `https://mochiai.art/v1/images/generations` 和 `/v1/images/edits`。支持 `low`、`medium`、`high`、`xhigh`、`max`，默认 `medium`。1K、2K、4K 分别为 2、2.5、3 金币/张。

OSODM「动态图片」线路 ID 为 `gpt-image-2.6-sunburst-osodm-1k`。上游为 `https://api.osodm.com`，模型 ID 为 `gpt-image-2.6-sunburst`，同步生成和编辑。静态 PNG 与动态 GIF 均为每张 2 积分，仅支持 1K，质量为 `low/medium/high`。

画布版与经典版选择这条线路后可设置格式和复杂度（auto/low/medium/high）。GIF 默认 `frame_count=9`、`frame_duration_ms=200`，分别可调为 2–16 帧和 20–2000ms。宽幅按参考项目的 1K 像素预算 1,572,864 缩放。服务端校验通过后再扣费，生图 JSON 和参考图编辑 multipart 都保留帧参数。预览与下载保留 GIF 动画，画布按帧播放。

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

启用「动态图片」时，在服务器 `.env` 配置 `GPT-image-2.6-sunburst_osodm-1k` 后重建 app。启动会补录缺失线路，也可手动运行：

```sh
docker compose exec -T app node scripts/activate-gpt-image-2-6-sunburst.cjs --animation --apply
```

GIF 参数参考 `D:\gpt-iamge-2`。真实上游需要保留 `output_format`、`complexity`、`frame_count`、`frame_duration_ms`，部署后用实际密钥验证返回文件的帧数。

## 验证

```sh
npx vitest run src/config/gptImage26.test.ts src/config/imageModels.test.ts imageModelCompatibility.test.cjs imageRouteCompatibility.test.cjs components/ImageFormConfig.test.tsx scripts/activate-gpt-image-2-6-sunburst.test.cjs --maxWorkers=1
node --test server.gpt-image-26.node.cjs productionImageRouteConfig.test.cjs imageRouteResolution.test.cjs imageCatalogInitialization.test.cjs
npm run build
```

HTTP 集成测试使用本地模拟上游验证三条线路的生成请求格式、质量和积分扣除，以及 GIF 生图和编辑的帧参数。真实上游生成与编辑需在部署密钥生效后验证。
