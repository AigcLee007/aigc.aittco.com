# 产品开发路线技术实现清单（文件级）

版本：v2.0  
更新时间：2026-04-07  
适用项目：`image.aittco.com` 当前仓库

---

## 一、总览（按你确认的 Phase）

| Phase | 周期 | 功能范围 | 业务价值 | 风险等级 |
|---|---|---|---|---|
| Phase 1 | 2 周 | Quick Edit、多平台裁切、后处理调色、`@引用`、Fast/Thinking | 最快提升出图效率与可控性 | 低 |
| Phase 2 | 2-4 周 | Mark 语义点选、对象移动+重融、多角度变体 | 从“会生成”升级到“会精修” | 中 |
| Phase 3 | 4-8 周 | 图内文字编辑、SVG/分层PSD导出 | 专业设计场景能力跃迁 | 高 |

当前总体进度：
- Phase 1：`@引用` 已完成，其余未开始
- Phase 2：未开始
- Phase 3：未开始

---

## 二、状态规范（必须每次更新）

| 状态 | 定义 | 必填字段 |
|---|---|---|
| 未开始 | 尚未编码 | 负责人、目标文件 |
| 进行中 | 正在开发 | 当前阻塞、下一步 |
| 已完成 | 已开发并通过自测 | 结果、验证命令、风险备注 |
| 阻塞 | 外部依赖未满足 | 阻塞原因、回退方案 |

更新规则：
1. 每个任务完成后，在任务行填写“完成结果”。
2. 在文末“变更日志”新增一条记录。
3. 每次至少记录 1 条验证动作（`tsc/test/手工验收`）。

---

## 三、Phase 1（先做，2 周，低风险）

### P1-0 目标拆分
- Quick Edit（快修）
- 多平台裁切
- 后处理调色
- `@引用`（仅提示词引用参考图）
- Fast/Thinking（生成策略档位）

### P1-1 `@引用` 语法（已完成）

#### 目标
支持：
- `@图1 @图2` 引用参考图（顺序、子集生效）
- 输入联动提示 + 卡片高亮
- 输入 `@` 自动弹出可选 `图1..图N`
- 参考图缩略图右键一键插入 `@图N`

#### 文件级实现
- 前端主逻辑：`components/ControlPanel.tsx`
  - 图片提交链路接入 `effectiveReferenceImages`
  - 视频提交链路接入 `effectiveVideoReferenceImages`
  - 参考图 UI 高亮、`@图N` 角标、输入联动提示、`@`联想下拉
  - 参考图缩略图右键菜单：`@引用 图N`
- 解析器模块：`src/utils/promptTags.ts`
  - 导出 `parsePromptReferenceTags`
  - 负责 `@图N` 解析、归一化与越界校验
- 状态层：`src/store/selectionStore.ts`
  - 复用现有参考图状态，不新增破坏性结构

#### 当前状态
- 状态：`已完成`
- 完成结果：
  - 支持 `@图N` 真实传参绑定（不是仅文案替换）
  - 支持 UI 联动提示（已引用/未找到）
  - 支持输入 `@` 自动建议 `图1..图N`，可回车/点击选择
  - 支持参考图缩略图右键 `@引用 图N` 自动插入提示词
- 验证：
  - `npx tsc --noEmit` 通过
- 风险备注：
  - 解析器已抽离到 `src/utils/promptTags.ts`，后续仅需补单测覆盖

---

### P1-2 Quick Edit（快修工作流）

#### 目标
让用户在画布上对刚生成图“一步快修”：
- 重新生成（同参数）
- 局部重绘（自动带入原图）
- 一键风格微调（亮度/对比/色温）

#### 文件级任务
1. 快修入口统一
- `components/ContextMenu.tsx`
  - 新增菜单组：`快速修图`
  - 子项：`重新生成`、`局部重绘`、`后处理调色`
- `components/CanvasNode.tsx`
  - hover 操作区新增快修按钮（桌面）
- `components/MobileView.tsx`
  - 长按后弹出快修 action sheet（移动端）

2. 参数回填与快修上下文
- `src/store/historyStore.ts`
  - 为 history item 增加 `generationConfigSnapshot`
- `src/store/selectionStore.ts`
  - 增加 `quickEditSourceNodeId`、`quickEditMode`
- `components/ControlPanel.tsx`
  - 打开面板时按快修上下文自动回填 prompt/ratio/model/size/line

3. 命令历史可撤销
- `src/commands/nodeCommands.ts`
  - 新增 `ApplyQuickEditCommand`
- `src/commands/HistoryManager.ts`
  - 接入 undo/redo

#### 验收标准
- 右键“重新生成”后，参数与原图一致，可直接提交
- 快修过程中不覆盖用户手工输入，除非用户确认回填

#### 状态
- `未开始`

---

### P1-3 多平台裁切（平台预设）

#### 目标
同一张图快速导出多个平台尺寸：
- 小红书封面、抖音、Instagram、YouTube Shorts、B站封面

#### 文件级任务
1. 裁切预设与 UI
- 新增：`src/constants/cropPresets.ts`
  - 含平台名、比例、像素建议
- 新增：`components/CropPresetPanel.tsx`
- `components/ControlPanel.tsx`
  - 加“平台裁切”入口按钮

2. 画布裁切交互
- `components/InfiniteCanvas.tsx`
  - 新增裁切框图层与拖拽手柄
- `src/hooks/useCanvasInteraction.ts`
  - 裁切框选中/缩放逻辑
- `src/store/canvasStore.ts`
  - 保存 `cropRegions`（按 nodeId）

3. 导出能力
- `src/utils/imageUtils.ts`
  - 新增按区域裁切导出函数
- `src/utils/fileParser.ts`
  - 新增批量命名规则（平台后缀）
- `components/BatchProcessModal.tsx`
  - 支持“按平台批量导出”

#### 验收标准
- 一键选择多个平台并导出多张图片
- 导出命名包含平台标识（例如 `_douyin_9x16`）

#### 状态
- `未开始`

---

### P1-4 后处理调色（非生成类）

#### 目标
在本地端对成图做轻量调色，不消耗生成额度：
- 亮度、对比度、饱和度、色温、锐化

#### 文件级任务
1. 调色面板
- 新增：`components/PostProcessPanel.tsx`
- `components/ContextMenu.tsx`
  - 新增“后处理调色”入口

2. 渲染与应用
- `components/CanvasNode.tsx`
  - 支持滤镜参数渲染（CSS/Konva filter）
- `src/store/canvasStore.ts`
  - 每个节点新增 `postProcessConfig`
- `src/hooks/useCanvasOperations.ts`
  - 应用/重置调色的操作函数

3. 持久化与导出
- `src/store/historyStore.ts`
  - 保存调色前后版本关系
- `src/services/assetStorage.ts`
  - 对调色结果缓存

#### 验收标准
- 调色操作实时预览，导出结果与预览一致
- 支持“重置调色”

#### 状态
- `未开始`

---

### P1-5 Fast / Thinking（生成策略档位）

#### 目标
在相同模型下提供策略档位：
- Fast：更快返回，适合草稿
- Thinking：更高质量，允许更长耗时

#### 文件级任务
1. 参数定义
- `src/store/selectionStore.ts`
  - 使用/扩展 `thinkingLevel`（已有字段）
- 新增：`src/constants/generationModes.ts`
  - 映射 `fast / balanced / thinking` 的参数模板

2. 提交链路
- `components/ControlPanel.tsx`
  - 提交 payload 注入策略字段
- `services/api.ts`
  - 统一透传策略字段
- `server.cjs`
  - 将策略字段映射到中转站可识别参数

3. UI 与反馈
- `components/ImageFormConfig.tsx`
  - 添加档位选择器
- `components/CanvasNode.tsx`
  - 展示结果标签（Fast/Thinking）

#### 验收标准
- 前后端日志可看到策略字段
- 不同策略的平均耗时有差异

#### 状态
- `未开始`

---

### P1-6 Phase 1 测试与发布门槛

#### 文件级任务
- 单测：
  - 新增：`src/test/promptTags.test.ts`
  - 更新：`src/test/controlPanel.property.test.ts`
- 回归：
  - 新增：`docs/phase1-regression-checklist.md`
- 脚本：
  - `package.json` 新增 `test:phase1`

#### 最低发布门槛
- `npx tsc --noEmit` 通过
- `npm run test` 核心用例通过
- 手工验收清单 100% 打勾

#### 状态
- `未开始`

---

## 四、Phase 2（中期，2-4 周，中风险）

### P2-0 目标拆分
- Mark 语义点选
- 对象移动 + 重融
- 多角度变体

### P2-1 Mark 语义点选

#### 目标
用户点选图片中的对象（人/猫/背景元素）后，系统自动生成 mask + 编辑提示。

#### 文件级任务
- UI：
  - 新增：`components/MarkEditPanel.tsx`
  - `components/Toolbar.tsx` 增加 Mark 工具
- 画布交互：
  - `components/InfiniteCanvas.tsx`
  - `src/hooks/useCanvasInteraction.ts`
- 语义分割服务：
  - 新增：`src/services/segmentationService.ts`
  - `server.cjs` 新增分割代理路由
- 存储：
  - `src/store/canvasStore.ts` 增加 `semanticMasksByNode`

#### 风险点
- 分割精度与边缘锯齿导致重绘瑕疵

#### 状态
- `未开始`

---

### P2-2 对象移动 + 重融

#### 目标
将选中对象拖到新位置，背景自动补洞并重融边缘。

#### 文件级任务
- `components/InfiniteCanvas.tsx`
  - 支持“对象层拖拽模式”
- `src/hooks/useCanvasOperations.ts`
  - `moveObjectWithReblend()`
- `src/services/api.ts`
  - 增加对象搬移重融接口调用
- `server.cjs`
  - 新增 move+inpaint 组合路由
- `src/store/historyStore.ts`
  - 记录对象原位置与新位置快照

#### 状态
- `未开始`

---

### P2-3 多角度变体（同主体）

#### 目标
基于参考主体生成“左侧面/背面/俯视”等多角度变体。

#### 文件级任务
- 新增：`src/constants/viewAngles.ts`
- `components/ControlPanel.tsx`
  - 角度变体选项
- `src/services/promptService.ts`
  - 角度提示词模板拼接
- `services/api.ts` + `server.cjs`
  - 变体生成路由与参数透传
- `components/BatchProcessModal.tsx`
  - 批量角度任务提交

#### 状态
- `未开始`

---

### P2-4 Phase 2 测试与质量门槛

#### 文件级任务
- 新增：`src/test/segmentationWorkflow.test.ts`
- 新增：`src/test/objectMoveReblend.test.ts`
- 新增：`docs/phase2-regression-checklist.md`

#### 质量门槛
- 复杂场景（发丝、透明材质）重融可接受
- 多角度主体一致性主观评分 >= 4/5

#### 状态
- `未开始`

---

## 五、Phase 3（长期，4-8 周，高风险）

### P3-0 目标拆分
- 图内文字编辑
- SVG / 分层 PSD 导出

### P3-1 图内文字编辑（检测+替换+重排版）

#### 目标
识别图中文字区域并替换文字，尽量保留原字体风格、透视与光影。

#### 文件级任务
- OCR：
  - 新增：`src/services/ocrService.ts`
  - `server.cjs` OCR 代理
- UI：
  - 新增：`components/TextEditPanel.tsx`
  - `components/CanvasNode.tsx` 文字框可编辑
- 排版引擎：
  - 新增：`src/utils/textLayout.ts`
- 重绘：
  - `src/services/api.ts` + `server.cjs` 文本区域重绘提交

#### 高风险点
- 字体匹配、透视变换、复杂背景遮挡

#### 状态
- `未开始`

---

### P3-2 SVG 导出

#### 目标
将结构化图层导出为可编辑 SVG（适合图形类内容）。

#### 文件级任务
- 新增：`src/services/svgExporter.ts`
- `src/store/canvasStore.ts`
  - 标准化图层结构（形状、文字、位图引用）
- `components/ContextMenu.tsx`
  - 新增“导出 SVG”

#### 风险点
- 位图与矢量混合场景保真

#### 状态
- `未开始`

---

### P3-3 分层 PSD 导出

#### 目标
按图层导出 PSD，供设计师在 Photoshop 深度编辑。

#### 文件级任务
- 新增：`src/services/psdExporter.ts`
- `src/store/canvasStore.ts`
  - 图层元数据扩展（混合模式/不透明度）
- `components/ContextMenu.tsx`
  - 新增“导出 PSD”
- `server.cjs`
  - 若前端性能不足，提供服务端导出路线

#### 风险点
- 多图层大图内存与导出稳定性

#### 状态
- `未开始`

---

### P3-4 Phase 3 测试与上线门槛

#### 文件级任务
- 新增：`src/test/textEditPipeline.test.ts`
- 新增：`src/test/exporters.test.ts`
- 新增：`docs/phase3-regression-checklist.md`

#### 上线门槛
- 文字编辑成功率 >= 95%（样本集）
- PSD 在主流版本 Photoshop 可正常打开

#### 状态
- `未开始`

---

## 六、跨 Phase 公共工程任务（持续执行）

### C-1 API 协议文档同步
- 文件：`docs/api-contract.md`（新建）
- 状态：`未开始`

### C-2 可观测性（request_id 全链路）
- 文件：`server.cjs`、`services/api.ts`
- 状态：`未开始`

### C-3 性能指标看板（出图耗时、加载耗时）
- 文件：`src/hooks/useGenerationTask.ts`、`src/utils/performance.ts`
- 状态：`未开始`

### C-4 Docker 更新流程标准化
- 文件：`Dockerfile`、`docker-compose.yml`、`deployment_guide.md`
- 状态：`未开始`

---

## 七、当前进度统计

| 维度 | 已完成 | 总数 | 完成率 |
|---|---:|---:|---:|
| Phase 1 功能项 | 1 | 6 | 16.7% |
| Phase 2 功能项 | 0 | 4 | 0% |
| Phase 3 功能项 | 0 | 4 | 0% |
| 跨 Phase 公共项 | 0 | 4 | 0% |
| 总计 | 1 | 18 | 5.6% |

> 注：目前“已完成”仅统计你明确要求并已落地验证的 `@引用`。

---

## 八、变更日志（每次完成必须追加）

| 日期 | 记录ID | Phase/任务 | 状态变化 | 影响文件 | 完成结果 | 验证 |
|---|---|---|---|---|---|---|
| 2026-04-07 | CHG-001 | P1-1 `@引用` 语法 | 未开始 -> 已完成 | `components/ControlPanel.tsx` | 完成 `@图N` 解析、子集传参、UI 高亮与联动提示 | `npx tsc --noEmit` |
| 2026-04-07 | CHG-002 | P1-1 `@引用` 增强 | 已完成 -> 已完成（增强） | `components/ControlPanel.tsx` | 去掉 `@模型`；新增输入 `@` 联想建议与缩略图右键 `@引用图N` | `npx tsc --noEmit` |
| 2026-04-07 | CHG-003 | P1-1 `@引用` 工程化 | 已完成 -> 已完成（工程化） | `components/ControlPanel.tsx`, `src/utils/promptTags.ts` | 将解析器从 ControlPanel 抽离为工具模块，提交链路改为模块调用 | `npx tsc --noEmit` |

---

## 九、下一个执行建议（按价值优先）

1. P1-2 Quick Edit（最直接提升用户体感）
2. P1-5 Fast/Thinking（给用户可控速度-质量选项）
3. P1-3 多平台裁切（提升成图复用效率）
4. P1-4 后处理调色（降低重复生图成本）
