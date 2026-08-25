# 管理员重置用户密码 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为后台管理员增加安全的用户密码重置能力，支持 file/MySQL 存储、服务端权限校验、会话失效和用户详情页操作。

**Architecture:** 新增独立 `POST /api/admin/users/:userId/password` 接口。服务端由 `requireAdminAccess` 认证，再调用两个 auth store 的同名管理方法；普通管理员仅可操作普通用户，超级管理员可操作全部用户。前端在 `UserAdminPanel` 增加新密码/确认密码表单，通过 `userAdminService` 调用接口并刷新详情。

**Tech Stack:** Node.js、Express、CommonJS auth stores、MySQL/file 双存储、React 19、TypeScript、Vitest。

---

### Task 1: 为 file 存储定义失败测试和管理重置方法

**Files:**
- Modify: `authStore.file.cjs`（新增 `resetUserPasswordByAdmin` 并导出）
- Test: `authStore.file.test.cjs`（若不存在则创建，复用现有 file store 测试初始化方式）

- [ ] **Step 1: 写失败测试**

覆盖四个行为：超级管理员可重置任意用户；普通管理员可重置普通用户；普通管理员重置管理员抛出 `ADMIN_PASSWORD_RESET_FORBIDDEN`；重置后旧 session 不再可用且新密码可登录。

```js
test('admin password reset hashes the new password and revokes target sessions', () => {
  const target = registerFixture('target@example.com', 'old-pass-123');
  const admin = registerFixture('admin@example.com', 'admin-pass-123', { role: 'admin' });
  const targetSession = loginFixture(target.email, 'old-pass-123');

  const updated = resetUserPasswordByAdmin(admin, target.userId, 'new-pass-123');

  expect(updated.passwordConfigured).toBe(true);
  expect(getSessionUserFromRequest({ headers: { authorization: `Bearer ${targetSession}` } })).toBeNull();
  expect(loginWithPassword({ email: target.email, password: 'new-pass-123' }).user.userId).toBe(target.userId);
});

test('regular admin cannot reset an admin account password', () => {
  const actor = registerFixture('admin@example.com', 'admin-pass-123', { role: 'admin' });
  const target = registerFixture('other-admin@example.com', 'old-pass-123', { role: 'admin' });

  expect(() => resetUserPasswordByAdmin(actor, target.userId, 'new-pass-123'))
    .toThrow(expect.objectContaining({ code: 'ADMIN_PASSWORD_RESET_FORBIDDEN' }));
});
```

- [ ] **Step 2: 运行测试确认按预期失败**

Run: `npx vitest --run authStore.file.test.cjs`

Expected: FAIL because `resetUserPasswordByAdmin` is not exported/implemented.

- [ ] **Step 3: 实现最小 file-store 逻辑**

在 `authStore.file.cjs` 中新增：先检查 `hasAdminRole(actor.role)`，查找目标用户，拒绝普通管理员操作非 `user` 角色；使用 `validatePassword` 和 `hashPassword` 更新 `passwordHash/passwordUpdatedAt/updatedAt`；删除 `store.sessions` 中所有目标用户 session；返回 `toPublicUser(user)`。错误码分别使用 `AUTH_LOGIN_REQUIRED`、`USER_NOT_FOUND`、`ADMIN_PASSWORD_RESET_FORBIDDEN`、`INVALID_PASSWORD`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest --run authStore.file.test.cjs`

Expected: PASS，且旧密码登录失败、新密码登录成功。

- [ ] **Step 5: 提交 file 存储变更**

```bash
git add authStore.file.cjs authStore.file.test.cjs
git commit -m "feat: support admin password reset in file auth store"
```

### Task 2: 为 MySQL 存储实现相同契约

**Files:**
- Modify: `authStore.mysql.cjs`（新增同名方法并导出）
- Test: `authStore.mysql.test.cjs`（按项目 MySQL 测试约定配置；无可用数据库时至少运行静态/契约测试）

- [ ] **Step 1: 写失败测试**

使用 fixture 创建普通用户、管理员、超级管理员，并断言同 Task 1 的成功、越权、旧 session 失效和密码校验行为。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest --run authStore.mysql.test.cjs`

Expected: FAIL because the method does not exist.

- [ ] **Step 3: 实现事务内更新**

在 `authStore.mysql.cjs` 新增 `async resetUserPasswordByAdmin(actor, userId, password)`：调用 `ensureAuthSchema()`；校验操作者是管理员；事务内 `SELECT * FROM auth_users ... FOR UPDATE`；应用角色权限和 `validatePassword`；写入 `password_hash/password_updated_at/updated_at`；执行 `DELETE FROM auth_sessions WHERE user_id = ?`；返回 `toPublicUser`，不包含 hash；在 module exports 中导出。

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest --run authStore.mysql.test.cjs`

Expected: PASS；若环境未配置 MySQL，记录跳过原因并运行完整测试套件中的可执行部分。

- [ ] **Step 5: 提交 MySQL 变更**

```bash
git add authStore.mysql.cjs authStore.mysql.test.cjs
git commit -m "feat: support admin password reset in mysql auth store"
```

### Task 3: 暴露管理员 HTTP API

**Files:**
- Modify: `server.cjs`（导入新方法，新增 POST 路由）
- Test: `server.auth.test.cjs`（或现有服务端路由测试文件）

- [ ] **Step 1: 写失败路由测试**

断言 `POST /api/admin/users/:userId/password` 使用管理员会话；body 只需要 `{ password }`；成功返回 `success: true` 和安全的用户详情；非管理员返回 403；目标不存在返回 404；无效密码返回 400。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest --run server.auth.test.cjs`

Expected: FAIL with 404 because the route does not exist.

- [ ] **Step 3: 实现路由**

从 `authStore.cjs` 解构 `resetUserPasswordByAdmin`，新增路由并调用 `requireAdminAccess(req, EMERGENCY_ADMIN_API_KEYS)`；调用 store 方法后通过现有 `buildAdminUserDetailPayload` 返回详情；错误统一经过 `sendAuthError`，保持项目现有状态码映射。

- [ ] **Step 4: 运行路由和回归测试**

Run: `npx vitest --run server.auth.test.cjs`

Expected: PASS，且现有 auth/admin 路由测试无回归。

- [ ] **Step 5: 提交 API 变更**

```bash
git add server.cjs server.auth.test.cjs
git commit -m "feat: add admin password reset endpoint"
```

### Task 4: 增加前端服务调用和用户详情表单

**Files:**
- Modify: `src/services/userAdminService.ts`（新增 `resetAdminUserPassword`）
- Modify: `components/UserAdminPanel.tsx`（表单状态、提交处理、权限展示）
- Test: `src/services/userAdminService.test.ts` 或现有组件测试文件

- [ ] **Step 1: 写失败服务测试**

断言请求方法为 POST、URL 正确、body 只包含 `{ password: '...' }`，不包含确认密码；失败响应转为 Error。

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest --run src/services/userAdminService.test.ts`

Expected: FAIL because `resetAdminUserPassword` is not defined.

- [ ] **Step 3: 实现服务方法**

签名为 `resetAdminUserPassword({ userId, password, ledgerPage, ledgerPageSize }): Promise<AdminUserDetailPayload>`；使用现有授权 header、URLSearchParams 和 `parseResponse`，请求体只发送 password。

- [ ] **Step 4: 写并运行组件行为测试**

验证普通管理员选中普通用户时可见表单；管理员目标账号时表单不可提交；短密码、确认不一致时不发请求；成功后调用服务、清空两个输入框、刷新详情并显示成功 Toast。

Run: `npx vitest --run components/UserAdminPanel.test.tsx`

Expected: FAIL until UI state and handler are added.

- [ ] **Step 5: 实现 UI**

在 `UserAdminPanel` 增加 `resetPassword/resetPasswordConfirm/resetting` 状态和 `handleResetPassword`；前端只做空值、二次确认、目标角色提示校验，密码长度最终由后端决定；在用户资料区放置两个 `type="password"` 输入框和提交按钮；允许条件为 `isSuperAdmin || detail.user.role === 'user'`，其他情况显示无权重置提示。

- [ ] **Step 6: 运行前端测试和构建**

Run: `npx vitest --run src/services/userAdminService.test.ts components/UserAdminPanel.test.tsx`; then `npm run build`

Expected: tests PASS，Vite build PASS。

- [ ] **Step 7: 提交前端变更**

```bash
git add src/services/userAdminService.ts src/services/userAdminService.test.ts components/UserAdminPanel.tsx components/UserAdminPanel.test.tsx
git commit -m "feat: add admin password reset controls"
```

### Task 5: 全量验证和安全回归

**Files:**
- Verify: `authStore.file.cjs`, `authStore.mysql.cjs`, `server.cjs`, `src/services/userAdminService.ts`, `components/UserAdminPanel.tsx`

- [ ] **Step 1: 运行全量自动化测试**

Run: `npm test`

Expected: 全部测试通过，无未处理 warning/error。

- [ ] **Step 2: 检查敏感数据边界**

Run: `rg -n "passwordHash|password_hash|resetAdminUserPassword|/admin/users/.*/password" authStore.file.cjs authStore.mysql.cjs server.cjs src/services/userAdminService.ts components/UserAdminPanel.tsx`

确认 HTTP response 和前端 state 不包含密码哈希；确认确认密码只存在于前端状态，不进入 fetch body；确认普通管理员无法通过直接请求重置管理账号。

- [ ] **Step 3: 检查工作区并提交最终变更**

Run: `git status --short; git diff --check`

Expected: 只包含本功能相关变更，无空白错误；保留用户已有的无关未跟踪文件，不执行清理或 reset。

