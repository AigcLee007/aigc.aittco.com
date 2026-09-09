# 兑换码全量管理与批量操作实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有超级管理员后台中提供兑换码全量分页查看、兑换码模糊搜索、可恢复禁用/启用、批量状态操作和批量复制，并让 MySQL 与本地 JSON 存储行为一致。

**Architecture:** 复用现有 `BillingPanel`、`/api/admin/redeem-codes` 和 billing store。新增四个 nullable 禁用字段，以 `redeemedAt`、`disabledAt` 推导三态状态；列表查询继续分页，状态更新用一个同时支持单条和批量的接口，复制全部结果由前端按分页拉取。

**Tech Stack:** CommonJS/Express、MySQL 8、JSON 文件存储、TypeScript、React、Vitest、Testing Library、Docker Compose。

**Design reference:** `docs/superpowers/specs/2026-09-09-redeem-code-management-design.md`

---

## 文件地图

- Create: `redeemCodePolicy.cjs` — 兑换码状态、搜索规范化和状态判定的纯函数。
- Create: `redeemCodePolicy.test.cjs` — 状态优先级和搜索规范化测试。
- Modify: `billingStore.mysql.cjs` — MySQL 字段、索引、列表搜索、状态更新和兑换拦截。
- Modify: `billingStore.file.cjs` — JSON 字段归一化、列表搜索、状态更新和兑换拦截。
- Create: `billingRedeemCodeManagement.test.cjs` — 文件存储契约和状态流程回归测试。
- Modify: `server.cjs` — 列表查询参数和批量状态接口。
- Modify: `src/services/accountService.ts` — 三态类型、查询参数、状态更新和全量分页读取服务。
- Modify: `components/BillingPanel.tsx` — 搜索、分页、选择、批量状态操作和复制操作。
- Create: `components/BillingPanel.test.tsx` — 管理后台交互回归测试。
- Modify: `Dockerfile` — 将新的后端策略模块复制进生产镜像。
- Modify: `docs/deployment_guide.md` — 增加兑换码管理上线后的验证步骤。

不要修改工作区中已有的预览图片、浏览器 profile 目录或其他未跟踪文件。

### Task 1: 建立兑换码状态与搜索策略

**Files:**
- Create: `redeemCodePolicy.cjs`
- Create: `redeemCodePolicy.test.cjs`

- [ ] **Step 1: 写状态和搜索策略的失败测试**

创建 `redeemCodePolicy.test.cjs`：

```js
const assert = require('assert');
const {
  getRedeemCodeStatus,
  matchesRedeemCodeSearch,
  normalizeRedeemCodeSearch,
} = require('./redeemCodePolicy.cjs');

describe('redeem code policy', () => {
  it('derives redeemed before disabled before active', () => {
    assert.equal(getRedeemCodeStatus({}), 'active');
    assert.equal(getRedeemCodeStatus({ disabledAt: '2026-09-09T00:00:00.000Z' }), 'disabled');
    assert.equal(
      getRedeemCodeStatus({
        disabledAt: '2026-09-09T00:00:00.000Z',
        redeemedAt: '2026-09-09T01:00:00.000Z',
      }),
      'redeemed',
    );
    assert.equal(
      getRedeemCodeStatus({
        disabled_at: '2026-09-09 00:00:00.000',
        redeemed_at: null,
      }),
      'disabled',
    );
  });

  it('normalizes only the code search value', () => {
    assert.equal(normalizeRedeemCodeSearch(' nb12-ab cd '), 'NB12ABCD');
    assert.equal(matchesRedeemCodeSearch({ codeValue: 'NB12ABCD3456EFGH' }, 'nb12-abcd'), true);
    assert.equal(matchesRedeemCodeSearch({ code_value: 'NB12ABCD3456EFGH' }, 'ZZZZ'), false);
    assert.equal(matchesRedeemCodeSearch({ codeValue: 'NB12ABCD3456EFGH' }, ''), true);
  });
});
```

- [ ] **Step 2: 运行策略测试确认失败**

Run:

```bash
npx vitest run redeemCodePolicy.test.cjs --maxWorkers=1 --exclude ".worktrees/**"
```

Expected: fail because `redeemCodePolicy.cjs` does not exist.

- [ ] **Step 3: 实现纯策略模块**

创建 `redeemCodePolicy.cjs`：

```js
const normalizeRedeemCodeSearch = (value = '') =>
  String(value || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .trim();

const getRedeemCodeStatus = (entry = {}) => {
  if (entry.redeemedAt || entry.redeemed_at) return 'redeemed';
  if (entry.disabledAt || entry.disabled_at) return 'disabled';
  return 'active';
};

const matchesRedeemCodeSearch = (entry = {}, search = '') => {
  const needle = normalizeRedeemCodeSearch(search);
  if (!needle) return true;
  const value = normalizeRedeemCodeSearch(
    entry.codeValue || entry.code_value || entry.code || '',
  );
  return value.includes(needle);
};

module.exports = {
  getRedeemCodeStatus,
  matchesRedeemCodeSearch,
  normalizeRedeemCodeSearch,
};
```

- [ ] **Step 4: 运行策略测试确认通过**

Run the command from Step 2. Expected: 2 tests pass.

- [ ] **Step 5: 提交策略模块**

```bash
git add redeemCodePolicy.cjs redeemCodePolicy.test.cjs
git commit -m "feat: add redeem code state policy"
```

### Task 2: 扩展 MySQL 和 JSON 存储契约

**Files:**
- Modify: `billingStore.mysql.cjs`
- Modify: `billingStore.file.cjs`
- Create: `billingRedeemCodeManagement.test.cjs`
- Modify: `Dockerfile`

- [ ] **Step 1: 写存储层失败测试和隔离测试夹具**

创建 `billingRedeemCodeManagement.test.cjs`。测试夹具在加载 `billingStore.file.cjs` 前设置临时 `BILLING_FILE_PATH`，测试结束删除模块缓存并恢复环境变量；该变量只用于测试隔离，生产环境不设置时继续使用根目录 `billing-data.json`，不新增部署必需配置。夹具使用 `ensureAccountForUser({ userId: 'redeem-test-user', email: 'redeem-test@example.com' })` 创建账户。

先加入这些断言：

```js
it('lists, searches, disables, re-enables, and blocks redemption', async () => {
  const account = store.ensureAccountForUser({
    userId: 'redeem-test-user',
    email: 'redeem-test@example.com',
  });
  const [created] = store.createRedeemCodes({
    points: 260,
    quantity: 1,
    createdByUserId: 'admin-1',
    createdByEmail: 'admin@example.com',
  });

  const found = store.listRedeemCodes({ search: created.code.slice(0, 8), pageSize: 100 });
  assert.equal(found.total, 1);
  assert.equal(found.codes[0].status, 'active');

  const disabled = store.updateRedeemCodeStatus({
    codes: [created.code],
    disabled: true,
    reason: 'activity ended',
    actorUserId: 'admin-1',
    actorEmail: 'admin@example.com',
  });
  assert.equal(disabled.changed, 1);
  assert.equal(disabled.codes[0].status, 'disabled');
  assert.throws(
    () => store.redeemCode(account.accountId, created.code, { userId: 'user-1', email: 'user@example.com' }),
    (error) => error.code === 'REDEEM_CODE_DISABLED',
  );

  const enabled = store.updateRedeemCodeStatus({
    codes: [created.code],
    disabled: false,
    actorUserId: 'admin-1',
    actorEmail: 'admin@example.com',
  });
  assert.equal(enabled.changed, 1);
  assert.equal(enabled.codes[0].status, 'active');
});

it('skips redeemed and unknown codes in a batch', () => {
  const result = store.updateRedeemCodeStatus({
    codes: ['NBUNKNOWN'],
    disabled: true,
    actorUserId: 'admin-1',
    actorEmail: 'admin@example.com',
  });
  assert.equal(result.notFound, 1);
  assert.equal(result.changed, 0);
});
```

- [ ] **Step 2: 运行存储测试确认失败**

Run:

```bash
npx vitest run billingRedeemCodeManagement.test.cjs --maxWorkers=1 --exclude ".worktrees/**"
```

Expected: fail because the temporary file path and `updateRedeemCodeStatus` contract do not exist.

- [ ] **Step 3: 增加 JSON 存储的可选测试文件路径和字段归一化**

在 `billingStore.file.cjs` 将固定路径改为：

```js
const BILLING_FILE = process.env.BILLING_FILE_PATH
  ? path.resolve(process.env.BILLING_FILE_PATH)
  : path.join(__dirname, 'billing-data.json');
```

在 `normalizeStore()` 中遍历 `next.redeemCodes`，为每条记录补齐 `disabledAt: null`、`disabledByUserId: null`、`disabledByEmail: null`、`disabledReason: ''`。`publicRedeemCode()` 改用 `getRedeemCodeStatus()` 并返回四个禁用字段。

- [ ] **Step 4: 增加 JSON 列表搜索和状态更新**

将 `listRedeemCodes({ page, pageSize, status })` 扩展为 `listRedeemCodes({ page, pageSize, status, search })`，使用策略模块过滤状态和兑换码片段，保留现有创建时间倒序和 `pageSize` 最大 100 的逻辑。新增 `updateRedeemCodeStatus({ codes, disabled, reason, actorUserId, actorEmail })`，规范化去重后统计 `changed`、`unchanged`、`skipped`、`notFound`；启用清空四个禁用字段。

- [ ] **Step 5: 增加 JSON 兑换拦截**

在 `billingStore.file.cjs` 的 `redeemCode()` 中，在已兑换判断前加入：

```js
if (redeemEntry.disabledAt) {
  throw new BillingError('REDEEM_CODE_DISABLED', 'Redeem code has been disabled');
}
```

使用 `getRedeemCodeStatus()` 确保旧记录和异常状态不会绕过禁用校验。

- [ ] **Step 6: 增加 MySQL schema 字段和索引**

在 `billingStore.mysql.cjs` 的 `ensureBillingSchema()` 增加幂等字段检查：

```sql
ALTER TABLE billing_redeem_codes ADD COLUMN disabled_at DATETIME(3) NULL;
ALTER TABLE billing_redeem_codes ADD COLUMN disabled_by_user_id VARCHAR(32) NULL;
ALTER TABLE billing_redeem_codes ADD COLUMN disabled_by_email VARCHAR(255) NULL;
ALTER TABLE billing_redeem_codes ADD COLUMN disabled_reason VARCHAR(255) NULL;
ALTER TABLE billing_redeem_codes ADD INDEX idx_billing_redeem_codes_disabled_at (disabled_at);
```

沿用当前 `information_schema.COLUMNS` 和 `ensureIndex()` 的幂等模式，重复启动不得因重复字段或索引失败。

- [ ] **Step 7: 增加 MySQL 列表、状态更新和兑换拦截**

将 MySQL `publicRedeemCode()` 映射四个禁用字段和三态状态；`listRedeemCodes()` 增加 `search` 和 `disabled` 筛选条件，搜索使用绑定参数 `WHERE code_value LIKE CONCAT('%', ?, '%')`。状态更新使用一个事务锁定请求记录并按状态规则更新；`redeemCode()` 在账户和账本更新前检查 `disabled_at`。

- [ ] **Step 8: 将策略模块加入生产镜像**

在 `Dockerfile` 的后端文件复制区增加：

```dockerfile
COPY redeemCodePolicy.cjs ./
```

- [ ] **Step 9: 运行存储测试确认通过**

```bash
npx vitest run redeemCodePolicy.test.cjs billingRedeemCodeManagement.test.cjs --maxWorkers=1 --exclude ".worktrees/**"
```

Expected: policy and file storage tests pass. If MySQL credentials are available, run the same contract against `billingStore.mysql.cjs` and initialize the schema twice.

- [ ] **Step 10: 提交存储层**

```bash
git add redeemCodePolicy.cjs redeemCodePolicy.test.cjs billingRedeemCodeManagement.test.cjs billingStore.file.cjs billingStore.mysql.cjs Dockerfile
git commit -m "feat: add redeem code disable state"
```

### Task 3: 暴露查询和批量状态 API

**Files:**
- Modify: `server.cjs`
- Modify: `src/services/accountService.ts`
- Create: `server.redeem-code-management.test.cjs`

- [ ] **Step 1: 扩展服务层类型和查询参数**

在 `RedeemCodeRecord` 中增加：

```ts
disabledAt: string | null;
disabledByUserId: string | null;
disabledByEmail: string | null;
disabledReason: string;
status: 'active' | 'disabled' | 'redeemed';
```

将 `fetchBillingRedeemCodes` 的参数改为：

```ts
{
  page?: number;
  pageSize?: number;
  status?: 'all' | 'active' | 'disabled' | 'redeemed';
  search?: string;
}
```

只在 `search` 非空时写入 URLSearchParams 的 `search` 字段，并把状态传给 `listRedeemCodes`。

- [ ] **Step 2: 增加服务层状态更新函数**

在 `src/services/accountService.ts` 增加：

```ts
export const updateBillingRedeemCodeStatus = async ({
  codes,
  disabled,
  reason,
}: {
  codes: string[];
  disabled: boolean;
  reason?: string;
}): Promise<{
  success: boolean;
  changed: number;
  unchanged: number;
  skipped: number;
  notFound: number;
  codes: RedeemCodeRecord[];
}> => {
  await ensureBillingIdentity();
  const response = await fetch(`${cleanUrl(API_BASE_URL)}/admin/redeem-codes/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(await getAuthorizedBillingHeaders()),
    },
    body: JSON.stringify({ codes, disabled, reason }),
  });
  return parseResponse(response);
};
```

- [ ] **Step 3: 增加服务层全量读取函数**

在同一文件增加分页循环，避免前端只复制当前页：

```ts
export const fetchAllBillingRedeemCodes = async ({
  status = 'all',
  search = '',
}: {
  status?: 'all' | 'active' | 'disabled' | 'redeemed';
  search?: string;
} = {}): Promise<RedeemCodeRecord[]> => {
  const first = await fetchBillingRedeemCodes({ page: 1, pageSize: 100, status, search });
  const records = [...first.codes];
  for (let page = 2; page <= first.totalPages; page += 1) {
    const payload = await fetchBillingRedeemCodes({ page, pageSize: 100, status, search });
    records.push(...payload.codes);
  }
  return Array.from(new Map(records.map((item) => [item.normalizedCode, item])).values());
};
```

- [ ] **Step 4: 扩展服务器列表路由**

在 `server.cjs` 的 `GET /api/admin/redeem-codes` 中读取并限制搜索参数：

```js
const search = String(req.query?.search || '').trim().slice(0, 80);
const result = await listRedeemCodes({
  page: parsePositivePage(req.query?.page, 1),
  pageSize: parsePositivePage(req.query?.pageSize, 20),
  status: String(req.query?.status || 'all').trim(),
  search,
});
return res.json({ success: true, ...result });
```

保持 `requireSuperAdminAccess(req)` 在查询前执行。

- [ ] **Step 5: 添加批量状态路由**

在现有 `POST /api/admin/redeem-codes` 附近新增 `PATCH /api/admin/redeem-codes/status`，并在路由中调用 `requireSuperAdminAccess`：

```js
app.patch('/api/admin/redeem-codes/status', async (req, res) => {
  try {
    const actor = await requireSuperAdminAccess(req);
    const codes = Array.isArray(req.body?.codes) ? req.body.codes : [];
    const disabled = req.body?.disabled === true;
    const reason = String(req.body?.reason || '').trim().slice(0, 255);
    if (codes.length < 1 || codes.length > 500) {
      return res.status(400).json({ error: 'codes must contain between 1 and 500 items' });
    }
    const result = await updateRedeemCodeStatus({
      codes,
      disabled,
      reason,
      actorUserId: actor?.userId,
      actorEmail: actor?.email,
    });
    await logAdminCatalogChange(req, {
      action: 'billing.update_redeem_code_status',
      entityType: 'redeem_code_batch',
      entityId: 'batch',
      summary: `${disabled ? 'Disabled' : 'Enabled'} ${result.changed} redeem code(s)`,
      detail: {
        requestedCount: codes.length,
        changed: result.changed,
        unchanged: result.unchanged,
        skipped: result.skipped,
        notFound: result.notFound,
        disabled,
        reason,
      },
    });
    return res.json({ success: true, ...result });
  } catch (error) {
    if (sendAuthError(res, error)) return;
    if (sendBillingError(res, error)) return;
    return res.status(500).json({ error: error.message || 'Failed to update redeem code status' });
  }
});
```

导入 `updateRedeemCodeStatus`，并将同名路由放在任何动态兑换码路径之前。

- [ ] **Step 6: 添加服务器契约测试**

创建 `server.redeem-code-management.test.cjs`，覆盖：未登录和普通管理员返回权限错误，超级管理员可以带 `search` 和 `status=disabled` 查询，批量请求返回四个计数，批量数量超过 500 返回 400，禁用码兑换返回 `REDEEM_CODE_DISABLED`。

- [ ] **Step 7: 运行 API 和类型测试**

```bash
npx vitest run server.redeem-code-management.test.cjs --maxWorkers=1 --exclude ".worktrees/**"
npm run build
```

Expected: server contract tests pass and TypeScript compilation succeeds.

- [ ] **Step 8: 提交 API 层**

```bash
git add server.cjs server.redeem-code-management.test.cjs src/services/accountService.ts
git commit -m "feat: add redeem code search and status API"
```

### Task 4: 改造超级管理员兑换码管理界面

**Files:**
- Modify: `components/BillingPanel.tsx`
- Create: `components/BillingPanel.test.tsx`

- [ ] **Step 1: 写后台交互失败测试**

创建 `components/BillingPanel.test.tsx`，mock `src/services/accountService` 和 `useToast`，使用超级管理员 session。测试加载 100 条、搜索请求参数、复制当前页和批量禁用：

```tsx
it('loads 100 codes, searches by code, and copies the current page', async () => {
  mocks.fetchBillingRedeemCodes.mockResolvedValue({
    success: true,
    total: 100,
    page: 1,
    pageSize: 100,
    totalPages: 1,
    codes: makeCodes(100),
  });
  render(<BillingPanel session={superAdminSession} />);
  expect(await screen.findByText('NB00-0000-0000-0000')).toBeTruthy();
  expect(screen.getByText('共 100 个')).toBeTruthy();

  fireEvent.change(screen.getByPlaceholderText('搜索兑换码'), { target: { value: 'NB00' } });
  fireEvent.click(screen.getByRole('button', { name: '搜索' }));
  await waitFor(() => expect(mocks.fetchBillingRedeemCodes).toHaveBeenLastCalledWith({
    page: 1,
    pageSize: 100,
    status: 'all',
    search: 'NB00',
  }));

  fireEvent.click(screen.getByRole('button', { name: '复制本页' }));
  await waitFor(() => expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
    makeCodes(100).map((item) => item.code).join('\n'),
  ));
});

it('supports selecting codes and batch disable', async () => {
  mocks.fetchBillingRedeemCodes.mockResolvedValue({
    success: true,
    total: 2,
    page: 1,
    pageSize: 100,
    totalPages: 1,
    codes: makeCodes(2),
  });
  mocks.updateBillingRedeemCodeStatus.mockResolvedValue({
    success: true,
    changed: 2,
    unchanged: 0,
    skipped: 0,
    notFound: 0,
    codes: makeCodes(2).map((item) => ({ ...item, status: 'disabled' })),
  });
  render(<BillingPanel session={superAdminSession} />);
  await screen.findByText('NB00-0000-0000-0000');
  fireEvent.click(screen.getByRole('checkbox', { name: '选择当前页兑换码' }));
  fireEvent.click(screen.getByRole('button', { name: '批量禁用' }));
  fireEvent.click(screen.getByRole('button', { name: '确认禁用' }));
  await waitFor(() => expect(mocks.updateBillingRedeemCodeStatus).toHaveBeenCalledWith({
    codes: makeCodes(2).map((item) => item.normalizedCode),
    disabled: true,
    reason: '',
  }));
});
```

测试夹具的 `makeCodes()` 返回完整 `RedeemCodeRecord`，包括四个禁用字段和三态 `status`。

- [ ] **Step 2: 运行组件测试确认失败**

```bash
npx vitest run components/BillingPanel.test.tsx --maxWorkers=1 --exclude ".worktrees/**"
```

Expected: fail because the search, pagination, selection, and batch controls do not exist.

- [ ] **Step 3: 增加状态和查询状态**

在 `BillingPanel.tsx` 增加：

```ts
const [codeSearchInput, setCodeSearchInput] = useState('');
const [codeSearch, setCodeSearch] = useState('');
const [codePage, setCodePage] = useState(1);
const [codePageSize, setCodePageSize] = useState(100);
const [codeFilter, setCodeFilter] = useState<'all' | 'active' | 'disabled' | 'redeemed'>('all');
const [selectedCodes, setSelectedCodes] = useState<Set<string>>(() => new Set());
const [statusUpdating, setStatusUpdating] = useState(false);
const [copyingCodes, setCopyingCodes] = useState(false);
const [statusReason, setStatusReason] = useState('');
```

让 `loadRedeemCodes` 依赖 `codePage`、`codePageSize`、`codeFilter`、`codeSearch`，并传递这四项参数。搜索、筛选或每页数量变化时设置页码为 1 并清空 `selectedCodes`。

- [ ] **Step 4: 增加搜索、分页和三态显示**

在兑换码记录标题区域增加搜索输入框、搜索按钮、清空按钮、状态选择器和每页数量选择器。分页底部显示：

```tsx
共 {codeData?.total || 0} 个
第 {codeData?.page || 1} / {codeData?.totalPages || 1} 页
```

状态标签按 `item.status` 显示“未使用”“已禁用”“已兑换”，不能继续把所有非 redeemed 状态显示为“未兑换”。每行显示禁用时间和原因（存在时）。

- [ ] **Step 5: 增加选择和批量状态操作**

为 `active`、`disabled` 记录增加复选框，为已兑换记录禁用状态复选框。使用 `normalizedCode` 作为选择集合键。工具栏提供带 `aria-label` 的批量禁用和批量启用按钮，操作前显示确认区域和可选原因，调用 `updateBillingRedeemCodeStatus`；成功后清空已变更选择、刷新当前页，并 Toast 显示 `changed`、`skipped`、`notFound` 数量。

- [ ] **Step 6: 增加三种复制操作**

抽出 `copyCodes(codes, label)`，统一使用 `navigator.clipboard.writeText(codes.join('\n'))` 并按数量提示。增加“复制选中”“复制本页”“复制全部结果”三个按钮；“复制全部结果”调用 `fetchAllBillingRedeemCodes({ status: codeFilter, search: codeSearch })`，显示 `copyingCodes` 加载状态并按 `normalizedCode` 去重。生成结果区域继续保留逐条复制，并增加“复制本次生成”按钮。

- [ ] **Step 7: 运行组件测试确认通过**

```bash
npx vitest run components/BillingPanel.test.tsx --maxWorkers=1 --exclude ".worktrees/**"
```

Expected: all component tests pass, including search request parameters, current-page copy, and batch disable request.

- [ ] **Step 8: 提交后台界面**

```bash
git add components/BillingPanel.tsx components/BillingPanel.test.tsx
git commit -m "feat: add redeem code management controls"
```

### Task 5: 更新部署说明并完成验证

**Files:**
- Modify: `docs/deployment_guide.md`

- [ ] **Step 1: 更新部署文档**

在 `docs/deployment_guide.md` 增加发布后检查：

```bash
cd /www/wwwroot/aigc.aittco.com
docker compose up -d --build app
docker compose ps
docker compose logs --tail=100 app
```

说明应用启动会自动增加 `billing_redeem_codes` 的四个禁用字段；管理员在后台验证分页、兑换码搜索、批量复制、禁用和重新启用。明确不要删除服务器上的 `.env`、数据库备份或上传目录。

- [ ] **Step 2: 运行后端语法和策略测试**

```bash
node --check redeemCodePolicy.cjs
node --check server.cjs
npx vitest run redeemCodePolicy.test.cjs billingRedeemCodeManagement.test.cjs server.redeem-code-management.test.cjs --maxWorkers=1 --exclude ".worktrees/**"
```

Expected: syntax checks exit 0 and all selected tests pass.

- [ ] **Step 3: 运行完整测试**

```bash
npx vitest run --maxWorkers=1 --exclude ".worktrees/**"
```

Expected: all repository test files pass with zero failures.

- [ ] **Step 4: 运行生产构建**

```bash
npm run build
```

Expected: Vite exits 0. Existing Browserslist、动态导入和大 chunk 警告可以保留，但不能有构建错误。

- [ ] **Step 5: 验证 Docker 条件并构建镜像**

```bash
docker info
docker compose build app
docker compose config
```

Expected: Docker 引擎可连接、镜像构建成功、Compose 配置渲染成功。若 Docker Desktop/Linux engine 未运行，记录具体错误，不声称 Docker 验证通过；其余测试和构建仍需完成。

- [ ] **Step 6: 检查差异和未跟踪文件**

```bash
git diff --check
git status --short
git diff --stat HEAD~5..HEAD
```

Expected: 功能文件无空白错误；工作区原有预览文件仍未被暂存；确认新增 MySQL 字段、API、前端三态显示和测试都在差异中。

- [ ] **Step 7: 提交文档并推送**

```bash
git add docs/deployment_guide.md
git commit -m "docs: add redeem code management deployment checks"
git push origin main
```

## 验收清单

- [ ] 后台默认每页 100 条，可切换 20、50、100 并翻页查看全部记录。
- [ ] 搜索只匹配兑换码，大小写、空格和连字符不影响结果。
- [ ] 选中 100 个未兑换码可以一次复制，每行一个兑换码。
- [ ] “复制全部结果”可跨页复制当前搜索和状态筛选下的全部兑换码，结果不重复。
- [ ] 未兑换码可以批量禁用；禁用码兑换失败。
- [ ] 禁用码可以批量重新启用，启用后恢复兑换。
- [ ] 已兑换码不能禁用或启用，但仍可复制和查看。
- [ ] 普通管理员、未登录请求无法调用状态接口。
- [ ] MySQL 和本地 JSON 存储通过同一组状态、搜索、分页和兑换拦截测试。
