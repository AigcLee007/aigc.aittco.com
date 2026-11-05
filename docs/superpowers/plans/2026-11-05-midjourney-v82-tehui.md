# Midjourney v8.2-特惠 Implementation Plan

**Goal:** 添加 OSODM Midjourney 特惠模型，四张一组，每组 8 金币。

**Architecture:** 在现有 OpenAI 图片异步线路上添加参数和结果适配，沿用持久化、计费和退款。前端按组提交，画布一次创建四个占位节点。已有数据库显式增量导入。

**Tech Stack:** CommonJS, TypeScript/React, JSON catalogs, Vitest, Node HTTP tests.

- [x] 为参数映射、非法输入、四张结果过滤、模型配置和组数界面编写失败测试。
- [x] 添加 `midjourneyImagePolicy.cjs` 并连接生成、任务查询及请求验证；补入 Docker 运行时。
- [x] 配置模型和唯一异步线路、标准与 2K 8 金币、数字质量选项，更新生产目录验证和重建脚本。
- [x] 画布版提交一组、四个节点和一张参考图；经典版按组提交、保留全部结果；限制合法比例并显示数字质量与组数价格。
- [x] 添加可重复执行的增量导入脚本和部署说明。
- [x] 运行聚焦测试、本地 HTTP 集成测试、构建、类型检查和 diff 检查。`npm run test:node` 有既有原图结果测试失败：断言 `/api/image-job-assets/`，实际接口返回 `/api/image-job-relay/`。
