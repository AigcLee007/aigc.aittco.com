# 图片暂存期限与下载提醒实施计划

**Goal:** 实际暂存 5 小时，页面承诺 4 小时并提醒下载；另给出 UI 建议。

**Architecture:** 沿用现有任务和资产服务。统一默认配置，将第四线路清理加入现有后台维护；React 共用静态提醒组件，VIP 共用提醒样式。

**Tech Stack:** Node/Express、React、原生 VIP HTML/CSS、Sharp、Node test/Vitest。

- [x] 在 imageJobAssets.test.cjs 添加真实图片五小时时间窗口与环境配置测试，先验证旧行为失败。
- [x] 将 imageJobAssets.cjs/imageJobService.cjs 默认 TTL 改为 `5 * 60 * 60 * 1000`，资产同时读取 `IMAGE_JOB_RETENTION_MS`。更新 Compose 与 .env.example 为 `18000000`。
- [x] generatedAssetService.cjs 默认改为 5 小时、导出原有清理函数；server.cjs 在资产维护时执行它。Compose 增加 `LINE4_LOCAL_STORAGE_TTL_HOURS: ${LINE4_LOCAL_STORAGE_TTL_HOURS:-5}`。
- [x] 添加静态 ImageRetentionNotice；放入桌面画布、移动作品页、图片创作面板和图片历史。VIP 结果区及历史使用相同的中文轻提示，保持现有生成和下载动作。
- [x] 更新部署文档，明确配置覆盖、云端四小时告知与实际五小时缓冲。整体 UI 重构只给建议。
- [x] 执行相关 Node 回归、TypeScript、构建与 diff 检查，提交并推送 codex/image-async-recovery。

验证：后台/资产/HTTP 36 项串行通过，第四线路资产 6 项通过，类型检查、语法检查和生产构建通过。用本地浏览器检查 1440×900 桌面、390×844 手机的提醒；手机画布提示上移，避开底部缩放读数。浏览器检查仅覆盖无登录时的提醒布局，实际账户和付费生图仍需服务器上线验证。

后续 UI 建议：保留 VIP 的左右结构，压缩左侧高级参数；结果卡突出下载、保存状态与到期时间；画布集中任务到可收起面板；手机顶部入口合并，解决现有公告/价格按钮遮挡作品页操作的问题。无需增加原图常驻渲染或高频倒计时。
