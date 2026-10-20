const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
test('deployment bounds logs, includes telemetry modules, and mounts only read-only host metrics',()=>{
  const compose=fs.readFileSync('docker-compose.yml','utf8');
  assert.equal((compose.match(/max-size: "10m"/g)||[]).length,2);
  assert.equal((compose.match(/max-file: "3"/g)||[]).length,2);
  assert.ok(compose.includes('./storage/operations:/app/storage/operations:ro'));
  assert.doesNotMatch(compose,/docker.sock/);
  const dockerfile=fs.readFileSync('Dockerfile','utf8');
  for(const name of ['operationsDashboard.cjs','operationsDashboardStore.cjs','operationsRuntimeMetrics.cjs','promptToolResponse.cjs'])assert.ok(dockerfile.includes(`COPY ${name} ./`));
  const collector=fs.readFileSync('scripts/collect-host-operations.py','utf8');
  assert.match(collector,/os.replace/);assert.match(collector,/timeout=3/);
});
