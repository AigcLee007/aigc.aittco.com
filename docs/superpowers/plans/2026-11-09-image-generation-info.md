# Image Generation Info Implementation Plan

> **For agentic workers:** Execute this approved plan inline using executing-plans, task by task.

**Goal:** 用户可查看每张图片生成时的模型和线路，刷新、恢复和编辑后来源仍准确。

**Architecture:** 在图片节点和版本、历史记录中保存可选 `generationInfo` 快照。服务端执行记录将实际模型/线路快照存入任务；前端在提交、轮询、恢复和历史转换中传递。共享信息组件供悬浮卡、图片快捷工具栏和历史详情使用。

**Tech Stack:** React, TypeScript, Zustand, Konva, Express/CJS, Vitest, node:test.

### Task 1: 来源数据与持久化
- [x] 测试先行：保存画布、版本和本地历史时快照仍存在，账号历史携带快照，旧图片信息缺失不被猜测。
- [x] types.ts 增加 ImageGenerationInfo；src/services/imageGenerationInfo.ts 提供白名单清洗、从记录生成快照、严格按账号和任务补齐原图的工具。
- [x] canvasStore.ts、historyStore.ts、useAccountGenerationHistory.ts 保留快照，useGenerationLogic.ts 将快照传给本地历史。
- [x] `npm test -- src/services/imageGenerationInfo.test.ts src/hooks/useAccountGenerationHistory.test.tsx src/store/historyStore.test.ts`

### Task 2: 提交、执行及恢复
- [x] 测试先行：真实执行快照出现在任务查询/列表，恢复时不会覆盖编辑图，提交切换配置不影响旧图。
- [x] server.cjs 在 buildGenerationRecordPayload 生成记录后保存模型、线路名称快照；imageJobService.cjs 公开白名单字段。
- [x] imageJobClient.ts 在发起请求时将目录名称快照分派到对应节点，接收服务端快照后更新；imageJobRequests.ts 保存紧凑恢复快照。
- [x] useGlobalPolling.ts 在轮询和恢复时接收服务端快照，沿已有按任务批量查询补齐历史。
- [x] useImageProcessor.ts 标记上传；ContextMenu.tsx、useCanvasOperations.ts 保留版本快照并在应用新结果时同步或清除来源。
- [x] `node --test imageJobService.test.cjs` 和相关 Vitest 恢复/提交测试。

### Task 3: 展示与验收
- [x] 测试先行：未知图片显示未记录，上传图片显示用户上传，信息对话框支持关闭、完整名称和复制。
- [x] components/ImageGenerationDetails.tsx 提供共享详情与可访问弹窗；SingleImageToolbar.tsx 增加信息按钮；SettingsModal.tsx 在图片历史中提供信息入口。
- [x] InfiniteCanvas.tsx 升级现有浮层，延时 300ms、按实际高度避让边界、交互时隐藏。
- [x] 运行相关测试、`npx tsc --noEmit`、`npm run build`；浏览器检查桌面和触屏布局。保留已有无关修改，不发布线上。
