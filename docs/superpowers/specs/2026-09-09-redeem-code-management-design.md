# 兑换码全量管理与批量操作设计

## 背景

当前管理后台的兑换码列表固定请求 `pageSize=20`，后端只支持 `all`、`active`、`redeemed` 三种筛选。兑换码状态由是否存在 `redeemedAt` 推导，MySQL 表和本地 JSON 存储都没有禁用字段，因此管理员无法检索全部兑换码，也无法阻止某个未使用兑换码被兑换。

兑换码生成接口已经支持单次最多生成 100 个兑换码，当前生成结果和历史记录都只提供逐条复制。这次改造聚焦兑换码的全量查看和管理，不改变兑换码生成格式、点数规则或单次生成上限。

## 目标

1. 管理员可以通过分页查看全部兑换码，默认每页显示 100 条，并可切换 20、50、100 条。
2. 管理员可以只按兑换码搜索，支持输入完整或部分兑换码，忽略大小写、空格和连字符。
3. 未兑换码支持禁用和重新启用，禁用码不能兑换。
4. 支持勾选多条兑换码后批量禁用或批量启用。
5. 支持复制选中兑换码、当前页兑换码，以及当前筛选条件下的全部兑换码。
6. 所有状态变更仅允许超级管理员执行，并写入现有管理员操作日志。
7. MySQL 和本地 JSON 存储保持相同行为，已有兑换码升级后默认可用。

## 非目标

- 不支持搜索备注、创建者邮箱、兑换人邮箱或其他字段。
- 不支持删除兑换码、修改兑换码点数或修改兑换码文本。
- 已兑换码不允许禁用、启用或回收。
- 不新增导出 CSV 文件功能；批量复制结果使用换行分隔的纯文本。
- 不改变现有单次生成最多 100 个兑换码的限制。

## 方案选择

采用扩展现有 `BillingPanel`、账户服务和 billing store 的方案，不另起兑换码后台页面，也不依赖服务器手工 SQL 脚本。这样可以复用现有超级管理员鉴权、分页响应格式、Toast 和管理员日志，改动集中且能同时覆盖 MySQL 与本地 JSON 回退存储。

独立页面会提供更大的表格空间，但会重复鉴权、列表加载和状态筛选逻辑；仅提供服务器导出脚本虽然开发量小，却不能满足后台禁用和恢复的日常操作。

## 状态模型

兑换码公开状态扩展为三种：

| 状态 | 判定 | 可兑换 | 可禁用 | 可启用 |
|---|---|---:|---:|---:|
| `active` | 未兑换且未禁用 | 是 | 是 | 否 |
| `disabled` | 未兑换且存在 `disabledAt` | 否 | 否（幂等） | 是 |
| `redeemed` | 存在 `redeemedAt` | 否 | 否 | 否 |

禁用和兑换互斥。状态判断顺序为 `redeemed`、`disabled`、`active`，但正常业务流程不会写入同时存在 `redeemedAt` 和 `disabledAt` 的记录。重新启用时清空当前禁用字段；禁用和启用的完整历史由管理员操作日志保存。

已有 MySQL 记录的新增字段均为 `NULL`，已有本地 JSON 记录缺少字段时按 `null` 归一化，因此升级不会改变现有兑换码的可用状态。

## 数据存储

### MySQL

在 `billing_redeem_codes` 增加以下 nullable 字段：

```sql
disabled_at DATETIME(3) NULL,
disabled_by_user_id VARCHAR(32) NULL,
disabled_by_email VARCHAR(255) NULL,
disabled_reason VARCHAR(255) NULL
```

增加 `idx_billing_redeem_codes_disabled_at (disabled_at)` 索引。`ensureBillingSchema()` 以幂等方式检查字段和索引，应用启动时自动补齐，不需要手工迁移脚本。

### 本地 JSON

`billing-data.json` 中每条兑换码记录增加同名 camelCase 字段：

```json
{
  "disabledAt": null,
  "disabledByUserId": null,
  "disabledByEmail": null,
  "disabledReason": ""
}
```

读取时对旧记录补默认值，写入时保留字段。MySQL 和 JSON 存储层分别实现相同的状态更新和兑换校验。

### 对外记录类型

`RedeemCodeRecord` 增加：

```ts
disabledAt: string | null;
disabledByUserId: string | null;
disabledByEmail: string | null;
disabledReason: string;
status: 'active' | 'disabled' | 'redeemed';
```

## 后端接口

### 列表接口

保留现有接口：

```http
GET /api/admin/redeem-codes
```

新增或扩展查询参数：

```text
page=1
pageSize=20|50|100
status=all|active|disabled|redeemed
search=<兑换码片段>
```

规则：

- `page` 最小为 1；`pageSize` 最小为 1，最大为 100。
- `status` 缺省为 `all`，未知值按 `all` 处理或返回现有一致的安全结果。
- `search` 最长 80 个字符，先执行与兑换相同的规范化：转大写、移除非字母数字字符，再对 `code_value` 做参数化的部分匹配。
- MySQL 使用绑定参数，不能拼接原始搜索文本；文件存储使用同样的规范化后 `includes` 匹配。
- 响应继续返回 `total`、`page`、`pageSize`、`totalPages`、`codes`，每条记录带三态 `status` 和禁用信息。

### 状态批量接口

单条和批量操作统一使用：

```http
PATCH /api/admin/redeem-codes/status
Content-Type: application/json
```

请求体：

```json
{
  "codes": ["NB12-ABCD-3456-EFGH"],
  "disabled": true,
  "reason": "活动结束"
}
```

约束和结果：

- `codes` 必须是 1 到 500 个字符串，服务端规范化并去重。
- `disabled=true` 只更新 `active` 记录；`disabled=false` 只更新 `disabled` 记录。
- 已兑换码、不存在的码和已经处于目标状态的码不抛出整批错误，分别计入 `skipped`、`notFound`、`unchanged`。
- 更新在单个事务中执行；数据库异常时整批回滚。
- 成功响应返回 `changed`、`unchanged`、`skipped`、`notFound` 数量，以及必要的更新后记录供前端刷新。
- 接口调用 `requireSuperAdminAccess`，普通管理员和未登录请求保持现有拒绝行为。

### 兑换校验

MySQL 和 JSON 存储层的 `redeemCode()` 在扣点前检查 `disabledAt` / `disabled_at`。禁用码返回 `BillingError`：

```text
code: REDEEM_CODE_DISABLED
message: Redeem code has been disabled
```

前端将该错误显示为“兑换码已禁用”。检查仍需在存储层事务内完成，不能只依赖后台列表状态，以防直接调用兑换接口绕过禁用。

### 操作日志

继续使用 `logAdminCatalogChange()`，新增动作名 `billing.update_redeem_code_status`。日志至少记录操作人、目标状态、请求数量、实际变更数量、跳过数量和原因，不在新增日志详情中重复保存完整兑换码文本。

## 前端交互

### 查询和分页

在 `BillingPanel` 的“最近兑换码记录”区域：

- 默认 `pageSize=100`。
- 增加每页数量选择器：20、50、100。
- 增加兑换码搜索输入框；按回车或点击搜索按钮提交，提交后回到第 1 页。
- 增加状态筛选：全部、未使用、已禁用、已兑换。
- 搜索、状态、每页数量变化时清空当前勾选并重置页码。
- 显示总数、当前页范围和分页按钮。

### 选择和状态操作

- `active` 和 `disabled` 记录显示复选框；`redeemed` 记录不可勾选状态变更。
- 支持勾选当前页全部可操作记录；选择集合可跨页保留，查询条件改变时清空。
- 有选中 `active` 时显示“批量禁用”；有选中 `disabled` 时显示“批量启用”。混合选择时两个按钮都可用，服务端按状态安全跳过不适用记录。
- 执行前显示确认提示，可填写可选原因；完成后显示变更、跳过和不存在数量，并刷新当前列表。
- 单行保留“禁用”或“启用”按钮，行为调用同一批量接口，避免两套后端逻辑。

### 批量复制

提供三个操作：

1. **复制选中**：按当前选择集合复制兑换码，每行一个。
2. **复制本页**：复制当前页全部兑换码，不受状态限制。
3. **复制全部结果**：按当前 `status` 和 `search` 条件，从第 1 页开始以 `pageSize=100` 拉取所有页面，去重后复制全部匹配码，每行一个。

复制失败时保留现有错误提示，不清空选择；复制成功显示实际复制数量。复制全部结果需要显示加载状态，避免重复点击。

## 服务层调整

在 `src/services/accountService.ts`：

- 扩展 `fetchBillingRedeemCodes` 参数类型，加入 `search` 和 `disabled` 状态。
- 新增 `updateBillingRedeemCodeStatus({ codes, disabled, reason })`。
- 新增 `fetchAllBillingRedeemCodes({ status, search })`，循环调用分页接口直到 `totalPages`，供“复制全部结果”使用。
- 所有请求继续通过 `ensureBillingIdentity()` 和 `getAuthorizedBillingHeaders()`，不新增鉴权机制。

## 错误处理和安全

- 所有状态接口只允许超级管理员；前端隐藏按钮不作为安全边界。
- 服务端对批量数量、搜索长度、原因长度和状态值做校验。
- 搜索和状态更新使用规范化兑换码，兼容用户粘贴带连字符或空格的格式。
- 禁用校验必须在兑换事务中完成。
- 复制功能只在已授权的管理页面执行，接口不会为了复制绕过现有权限。
- 禁用操作日志不保存完整兑换码，避免增加兑换凭证泄露面。

## 测试范围

### 存储层

- 旧记录归一化后为 `active`。
- 列表按 `all`、`active`、`disabled`、`redeemed` 正确过滤并分页。
- 只按兑换码规范化片段搜索，带连字符和大小写的输入得到相同结果。
- 单条和批量禁用、启用均正确更新字段。
- 已兑换码不可禁用或启用；重复启用/禁用保持幂等。
- 禁用码兑换失败并返回 `REDEEM_CODE_DISABLED`，启用后可以兑换。
- MySQL schema 初始化可重复执行；JSON 存储行为与 MySQL 契约一致。

### API 和前端

- 超级管理员可以分页、搜索和改变状态；普通管理员返回权限错误。
- 批量接口正确返回 changed、unchanged、skipped、notFound 计数。
- 前端搜索和筛选会重置页码并清空选择。
- 复制选中、本页和全部结果均按换行输出，且不会重复。
- 已兑换行没有状态操作入口，禁用/启用后列表状态刷新。

现有 Vitest 全量测试、生产构建和 Node 语法检查继续作为合并门槛。

## 上线和回滚

上线前备份 `billing_redeem_codes`：

```bash
mysqldump -uroot -p "$MYSQL_DATABASE" billing_redeem_codes > redeem-codes-before-management.sql
```

部署顺序：

```bash
cd /www/wwwroot/aigc.aittco.com
git pull --ff-only origin main
docker compose up -d --build app
docker compose ps
docker compose logs --tail=100 app
```

应用启动时自动增加 MySQL 字段。发布后验证：

1. 管理后台能切换每页 100 条并翻页。
2. 搜索完整或部分兑换码能得到正确结果。
3. 禁用码无法兑换，重新启用后恢复兑换。
4. 批量复制结果与列表数量一致。

新增字段均为 nullable，发布前回滚不会破坏旧数据；但旧版本程序不会识别禁用字段。**一旦生产环境使用过禁用功能，不应直接回滚到不含禁用校验的旧版本**，否则旧版本可能再次允许兑换已禁用码。需要回滚时应恢复备份并同时回退应用，或保持包含禁用校验的版本运行。

## 验收标准

- 超级管理员可以查看任意页的兑换码，并通过兑换码片段定位记录。
- 100 个兑换码可以一次勾选并批量复制；跨页结果也能一次复制。
- 未兑换码禁用后立即无法兑换，重新启用后恢复可兑换。
- 已兑换码不会被批量禁用或启用。
- MySQL 生产数据和本地 JSON 回退数据都通过同一组行为测试。
- 全量测试和生产构建通过，未引入新的环境变量。
