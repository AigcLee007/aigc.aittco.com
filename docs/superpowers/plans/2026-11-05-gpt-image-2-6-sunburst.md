# GPT-Image-2.6-Sunburst Implementation Plan

**Goal:** 接入用户提供的 2.6 原生线路、三档质量和尺寸积分。

**Architecture:** 沿用现有 JSON 模型/线路目录和 GPT 图片请求流程。已有 MySQL 目录通过增量脚本导入，不在启动时自动恢复目录条目。

**Tech Stack:** JSON, TypeScript/React, CommonJS, Vitest, MySQL.

## Execution

- [x] 在 `src/config/gptImage26.test.ts` 和现有兼容性/组件测试中覆盖模型、线路、计费、质量回退及经典版行为；运行并确认缺少 2.6 时失败。
- [x] 更新 `config/imageModels.json`、`config/imageRoutes.json`、`config/production-image-routes.json`，以同一线路 ID 和上游模型配置 4/4.5/5 分。
- [x] 扩展 `imageModelCompatibility.cjs`、`src/config/imageModels.ts`、经典版 GPT 检测以包含 2.6；复用现有尺寸转换和 GPT 参数白名单。
- [x] 修正 React、经典版和服务端针对无 auto 线路的质量回退：保留有效值，否则选择 auto（受支持时）、medium 或首个可用值。
- [x] 新增 `scripts/activate-gpt-image-2-6-sunburst.cjs`，默认预览、`--apply` 执行，仅新增缺失项；对重复执行和已有配置保留做测试。
- [x] 更新生产目录的数量/默认线路验证与生成脚本，确保后续重建配置保留新线路。
- [x] 运行相关 Vitest、Node 测试、`npm run build`、`git diff --check`；在 `docs/gpt-image-2-6-sunburst.md` 记录部署和验证方式。
