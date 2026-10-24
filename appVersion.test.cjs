const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

test('version and image catalogs bypass caches and report the built frontend ID', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'app-version-'));
  for (const key of Object.keys(process.env).filter((key) => key.startsWith('MYSQL_'))) process.env[key] = '';
  process.env.AUTH_STORE_FILE = path.join(root, 'auth.json');
  process.env.BILLING_FILE_PATH = path.join(root, 'billing.json');
  process.env.IMAGE_JOB_STORAGE_ROOT = root;

  require('./imageModelStore.cjs').getImageModelCatalog = async () => ({ defaultModelId: '', models: [] });
  require('./imageRouteStore.cjs').getImageRouteCatalog = async () => ({ defaultRouteId: '', defaultNanoBananaLine: 'line1', routes: [] });

  const app = require('./server.cjs');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await app.imageJobService?.stop();
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  });
  const request = (url) => fetch(`http://127.0.0.1:${server.address().port}${url}`);

  const versionResponse = await request('/api/version');
  assert.match(versionResponse.headers.get('cache-control'), /no-store/);
  const version = await versionResponse.json();
  assert.equal(version.buildId, (await fs.readFile(path.join(__dirname, 'dist', 'build-id.txt'), 'utf8')).trim());
  assert.match(version.catalogVersion, /^[a-f0-9]{64}$/);

  for (const pathName of ['/api/image-models/catalog', '/api/image-routes/catalog', '/vip', '/']) {
    const response = await request(pathName);
    assert.match(response.headers.get('cache-control'), /no-store/, `${pathName} must not be cached`);
  }
});
