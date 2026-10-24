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
  assert.match(compose,/APP_COMMIT: \$\{APP_COMMIT:-\}/,'compose must forward the deployed commit into the image build');
  assert.match(dockerfile,/ARG APP_COMMIT=/);
  // Every local backend module server.cjs loads must be copied into the runtime image.
  const path=require('node:path');const seen=new Set();const queue=['server.cjs'];
  while(queue.length){const file=queue.pop();if(seen.has(file))continue;seen.add(file);
    for(const match of fs.readFileSync(file,'utf8').matchAll(/require\(\s*['"]\.\/([^'"]+)['"]\s*\)/g)){
      let target=match[1];if(!path.extname(target))target+=fs.existsSync(`${target}.cjs`)?'.cjs':'.js';
      if(fs.existsSync(target))queue.push(target);
    }}
  for(const name of [...seen].filter(file=>!file.includes('/')))assert.ok(dockerfile.includes(`COPY ${name} ./`),`${name} is required at runtime but missing from Dockerfile`);
  for(const name of ['operationsDashboard.cjs','operationsDashboardStore.cjs','operationsRuntimeMetrics.cjs','promptToolResponse.cjs'])assert.ok(dockerfile.includes(`COPY ${name} ./`));
  const collector=fs.readFileSync('scripts/collect-host-operations.py','utf8');
  assert.match(collector,/os.replace/);assert.match(collector,/timeout=3/);
});
