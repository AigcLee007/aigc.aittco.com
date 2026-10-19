const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

test('operations endpoints enforce admin access and serve read-only bounded snapshots', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'admin-ops-'));
  for (const key of Object.keys(process.env).filter(key => key.startsWith('MYSQL_'))) process.env[key] = '';
  process.env.AUTH_STORE_FILE = path.join(root, 'auth.json');
  process.env.BILLING_FILE_PATH = path.join(root, 'billing.json');
  process.env.IMAGE_JOB_STORAGE_ROOT = root;
  const auth = require('./authStore.cjs');
  const app = require('./server.cjs');
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await app.operationsDashboard?.stop(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await fs.rm(root, {recursive:true,force:true}); });
  const admin = await auth.registerWithPassword({email:'root@example.com',password:'root-pass-123'});
  const normal = await auth.registerWithPassword({email:'member@example.com',password:'member-pass-123'});
  const login = async user => (await auth.loginWithPassword({email:user.user.email,password:user===admin?'root-pass-123':'member-pass-123'})).sessionToken;
  const adminToken = await login(admin), normalToken = await login(normal);
  const get = (url, token) => fetch(`http://127.0.0.1:${server.address().port}${url}`, {headers:token?{'x-auth-session':token}:{}});
  for (const endpoint of ['/summary','/trends','/tasks','/tasks/missing','/failures','/incidents']) {
    assert.equal((await get('/api/admin/operations'+endpoint)).status,401);
    assert.equal((await get('/api/admin/operations'+endpoint,normalToken)).status,403);
  }
  const summary = await get('/api/admin/operations/summary',adminToken);
  assert.equal(summary.status,200);
  assert.match(summary.headers.get('cache-control'), /no-store/);
  const data = await summary.json();
  assert.equal(data.coverage.scope,'durable_image_jobs');
  assert.equal(data.coverage.available,false);
  assert.equal(data.failures.successRate,null);
  assert.equal(data.runtime.limits.concurrency,48);
  assert.equal(data.runtime.limits.userConcurrency,6);
  assert.ok(data.coverage.excluded.includes('video'));
  assert.equal((await get('/api/admin/operations/trends?window=forever',adminToken)).status,400);
  assert.equal((await get('/api/admin/operations/tasks?status=bogus',adminToken)).status,400);
  assert.equal((await get('/api/admin/operations/tasks/missing',adminToken)).status,404);
  const jobs = await (await get('/api/admin/operations/tasks?limit=999',adminToken)).json();
  assert.deepEqual(jobs.items,[]);
  assert.equal(jobs.nextCursor,null);
  const original = app.imageJobService.store.list;
  let scans = 0; app.imageJobService.store.list = async () => { scans++; throw Error('dashboard must not scan jobs'); };
  try { for(let i=0;i<10;i++) assert.equal((await get('/api/admin/operations/summary',adminToken)).status,200); }
  finally { app.imageJobService.store.list = original; }
  assert.equal(scans,0);
});
