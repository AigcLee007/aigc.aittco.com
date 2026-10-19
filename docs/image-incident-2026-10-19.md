# 2026-10-19 图片重复请求与画布异常排查

## 已有证据

用户截图时间为 2026-10-19 01:18:55–01:23:01；下方命令按该时间为北京时间处理，换算为 UTC 2026-10-18 17:18:55–17:23:01。若浏览器系统时区不是北京时间，需相应调整查询区间。

四次成功生成的价格为 3、4.5、3、3.4 点，合计 13.9 点。三笔 nano-banana-pro 的 12 点扣费各有对应 12 点退款。截图可见预扣合计 49.9 点、退款 36 点，净扣 13.9 点。7 条请求和 4 成功 / 3 失败与此相符，但账单条数本身不能确定请求来源。不要再给这三笔重复退款。

已读取线上页面发布的 `/assets/index-DHuyCk72.js`，确认线上也包含下述前端补发代码。未读取本次生产数据库或 Nginx 原始日志；没有执行线上付费生成、部署、退款或数据库改动。

## 已复现并修正

### 1. 恢复轮询提前补发，且缺少 JSON 请求头

`submitImageJob` 保存恢复凭据并触发 `image-job-submitting`，随后等待 IndexedDB 保存，最后才发送正式 POST。这个空隙内，画布查询 `request-*` 得到 404，就会通过 `queryImageJob` 补发。

补发只带 `X-Auth-Session`，没有 `Content-Type: application/json`。Express 不解析字符串请求体，`req.body` 为空，因而丢失 routeId、prompt、asyncTask。旧的生成处理器会选默认线路并预扣点。正常 POST 继续按用户选择的线路生成。这可解释“没选择官方 T3 却多出默认线路失败退款”；要把三笔线上账单逐笔归因，还需要下方只读查询。

修正：所有图片任务 JSON POST 显式带 Content-Type；正常提交尚在准备或等待时，恢复查询不得抢先补发；服务端三个图片入口在路由与扣费之前拒绝未解析的请求体和空提示词。

测试已证实旧行为：恢复补发缺少请求头；正常提交尚未发出就多出一个 POST；错误格式请求进入默认线路、调用模拟上游并返回 200。修复后错误格式返回 415，空 JSON 返回 400，余额、生成记录和上游调用数不变。

进一步发现并修正两处隐式换线：显式 routeId 不存在或停用时回落默认线路；图片编辑在 editPath 为空时回落默认线路。现在前者返回错误，后者对 OpenAI 兼容线路使用同一提供方的默认编辑路径，对不支持编辑的线路返回错误。集成测试覆盖三个入口、同步/异步、无效/停用线路，并核对余额、记录和上游调用均不增加；编辑记录保留所选 routeId。

### 2. 画布后台恢复使用过期状态

`useGlobalPolling` 的恢复逻辑在等待持久化前取了节点快照。等待过程中正常任务轮询可能已完成并显示图片，恢复逻辑继续用旧的 loading=true 快照，又把图片改回生成中。成功任务的去重状态可能让它无法再次完成展示。

已增加回归测试并修正为等待后重新读取最新节点。该缺陷可复现“页面未刷新、已完成结果又被重新打开”，但不能直接证明截图里四个节点完全消失由它造成。现场仍需区分：节点被移除、被移到视口外，或只是不显示图像。历史记录保留也不能证明原图仍在保留期内。

### 3. 缩放与撤销覆盖后来的生成结果

新增 6 个测试在旧实现全部失败：滚轮事件使用渲染时的旧节点数组，会丢掉随后新增的节点或已完成的图片字段；SetNodesCommand 撤销/重做整份快照，会丢掉后台恢复的节点、覆盖生成结果，重做生成动作还会恢复空白占位节点。

修正：滚轮执行时读取当前画布；撤销/重做按节点和改变的字段应用，保留后台结果与无关节点；临时移出的节点保存最新结果，以便重做。所有回归测试通过。它们是已复现的代码缺陷，但没有用户当时浏览器操作记录，不能断言就是本次四图消失的现场原因。

### 最新线上核对与用户反馈

用户再次测试刷新、设置、管理后台和切换经典版，未重现画布丢图，但默认 T3 仍被调用。重新请求线上主页（禁用缓存）和 JS 确认仍是 `/assets/index-DHuyCk72.js`，内容与最初下载完全一致，SHA-256 为 `b8aeaae6377fe9289cef4e55c9f3dc742ab3590bb1718658411f361c608744ff`。本地新构建入口为 `index-nNpMC9Uu.js`。截至此核对，修复没有部署，用户线上测试尚未运行修复代码。

用户最终选择：将修复推送至 GitHub，由用户在服务器自行更新。本次不进行远程部署。

## 可选现场诊断（用户当前不要求恢复旧四图）

先从历史记录下载这 4 张结果。不要点击“再次生成”来恢复图片，也不要清缓存或重置工作区；这些操作会增加扣费或丢失现场。可用已有的上传功能把下载的图片重新放回画布，不产生生图费用。

若现场还在，打开 F12 → Console，执行以下只读检查。它只读取画布本地保存状态，不能代表当前内存状态；不输出提示词、图片内容、完整链接或登录凭据：

```js
(async () => {
  if (!(await indexedDB.databases()).some(db => db.name === 'keyval-store')) {
    console.log({ canvasStorage: '不存在' }); return;
  }
  const db = await new Promise((resolve, reject) => {
    const r = indexedDB.open('keyval-store'); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  });
  try {
    const saved = await new Promise((resolve, reject) => {
      const r = db.transaction('keyval').objectStore('keyval').get('infinitemuse-storage');
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    const state = (typeof saved === 'string' ? JSON.parse(saved) : saved)?.state;
    const transform = state?.canvasState;
    console.log('保存的画布状态', transform);
    console.table((state?.nodes || []).map(n => ({
      id: n.id, taskId: n.taskId, createdAt: n.createdAt, loading: n.loading, error: n.error,
      x: n.x, y: n.y, width: n.width, height: n.height, hasSource: !!n.src, hasAsset: !!n.assetId,
      inViewport: transform ? n.x * transform.scale + transform.offset.x < innerWidth
        && (n.x + n.width) * transform.scale + transform.offset.x > 0
        && n.y * transform.scale + transform.offset.y < innerHeight
        && (n.y + n.height) * transform.scale + transform.offset.y > 0 : null,
    })));
  } finally { db.close(); }
})();
```

结果若仍有这四个 taskId，先检查 loading/error 和 inViewport；如果只有两天前旧图，继续查控制台错误与节点移除/覆盖路径，不能把问题当作上游没生成。Network 开启 Preserve log 后，保留 `/image-jobs/request/`、`/generate`、`/task/` 的时间顺序。不要分享带登录头或签名图片 URL 的完整 HAR。

## 服务器只读核对

将 `scripts/diagnose-image-window.cjs` 上传到服务器项目的 scripts 目录后，在服务器执行：

```sh
cd /www/wwwroot/aigc.aittco.com
docker compose cp scripts/diagnose-image-window.cjs app:/app/scripts/diagnose-image-window.cjs
docker compose exec -T app node scripts/diagnose-image-window.cjs '2026-10-19T01:15:00+08:00' '2026-10-19T01:25:00+08:00'
```

可在末尾追加受影响账号 accountId 缩小范围。脚本只 SELECT，不调用生成、不轮询上游、不修改余额；输出按 UTC 标注，关联 ledger、generation_records、image_jobs，只输出必要标识和计数。窗口内净消费不包含窗口外退款；truncated=true 时应缩小区间。

预期异常特征：默认线路记录 emptyPrompt=1，缺少 modelId、durable imageJobId 或 taskId，而紧邻的正常记录有用户选择的 routeId、模型和画布节点 ID。只有查到这些关联，才能确认三笔账单与复现的缺陷一致。

对应时间段应用日志可在服务器本地查看：

```sh
docker compose logs --timestamps --since '2026-10-18T17:15:00Z' --until '2026-10-18T17:25:00Z' app
```

留意默认线路的 `modelId: null`、`prompt: 'undefined...'`，并核对 Nginx 中 request 查询 404 后紧跟 POST 的顺序。日志可能包含提示词或上游链接，应只提供脱敏摘要。

## 上线与验收

本地已修改：`server.cjs`、`src/services/imageJobClient.ts`、`src/hooks/useGlobalPolling.ts`、`src/hooks/useZoom.ts`、`src/commands/nodeCommands.ts`，以及回归测试和诊断脚本。修复尚未部署。

先备份服务器对应源码和当前镜像，检查并等待正在生成的任务完成，再上传这次差异。不要覆盖服务器 `.env`、数据库 JSON、uploads 或 storage。前端和后端都需要更新：只重启后端不能消除浏览器补发竞态。

```sh
cd /www/wwwroot/aigc.aittco.com
git pull --ff-only origin main
docker compose up -d --build app
docker compose ps
docker compose logs --tail=60 app
```

发布后确认页面加载新 JS 文件，关闭仍运行旧代码的标签页再重新进入。执行一次用户同意的受控生成：应只有一笔正常扣费、无默认 T3 额外失败；结果显示后等待至少 60 秒，切换后台再回来，并刷新，确认画布和历史都保留。禁止把自动测试连接真实付费上游。

## 本地验证记录

- 先观察缺陷测试失败，再修正；图片提交、轮询恢复、API、画布状态及本地恢复相关测试已通过。
- `npm run test:node`：145 项通过。
- 前端相关回归：14 个测试文件、104 项通过。
- 隔离浏览器：四个选择线路各 POST 一次、均为 JSON；两次后台恢复周期（加速浏览器时钟）、缩放、布局撤销/重做、三次移出/移入视口、focus/online 和刷新后，1 张旧图 + 4 张模拟结果均在，未发生页面 JS 异常。API 全部模拟，未连接付费上游。非测试业务 API 的 503 是隔离桩主动返回，不属于线上错误。结果见 `output/incident-2026-10-19/browser-report.log`。
- `npx tsc --noEmit`：通过。
- `npm run build`：通过，有现有的大 bundle 警告。
- 生产数据库、用户当前浏览器内存与上线验收尚未执行，因此不宣称线上故障已完全解决。
