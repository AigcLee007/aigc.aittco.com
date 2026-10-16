const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

let createImageJobStore, createImageJobService;
try { ({ createImageJobStore } = require('./imageJobStore.cjs')); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }
try { ({ createImageJobService } = require('./imageJobService.cjs')); } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }

const waitFor = async (predicate) => {
  for (let i = 0; i < 500; i++) { const value = await predicate(); if (value) return value; await new Promise(r => setTimeout(r, 10)); }
  assert.fail('background task did not reach expected state');
};
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return {promise,resolve}; };
const harness = async (t, options = {}) => {
  assert.equal(typeof createImageJobStore, 'function', 'durable image job store is implemented');
  assert.equal(typeof createImageJobService, 'function', 'background image job service is implemented');
  const root = await fs.mkdtemp(path.join(process.env.IMAGE_JOB_TEST_ROOT || os.tmpdir(), 'image-job-test-'));
  const store = createImageJobStore({root, useMySql: false});
  const service = createImageJobService({ store, pollIntervalMs: 15, deadlineMs: 10000, ...options });
  await service.start();
  t.after(async () => { await service.stop();await fs.rm(root,{recursive:true,force:true}); });
  return {root,store,service};
};
const submission = (overrides = {}) => ({userId:'owner-a',endpoint:'/api/generate',body:{prompt:'a bird',clientRequestId:'req-1',asyncTask:true},...overrides});
const remoteResult = {images:['https://images.example/a.png']};

test('all permanent output previews survive job persistence and reach account record settlement', async t => {
  const previews = ['/permanent/one.preview.webp', '/permanent/two.preview.webp'];
  let settled;
  const { store, service } = await harness(t, {
    execute: async () => ({ images: ['https://images.example/one.png', 'https://images.example/two.png'] }),
    assets: { prepare: async ({ resultUrls }) => ({ resultUrls, previewUrl: previews[0], payload: { preview_urls: previews }, storageStatus: 'saved' }) },
    settleSuccess: async job => { settled = job; },
  });
  const ack = await service.submit(submission());
  await waitFor(() => settled);
  assert.deepEqual((await service.get(ack.task_id, 'owner-a')).preview_urls, previews);
  assert.deepEqual((await store.get(ack.task_id)).payload.preview_urls, previews);
  assert.deepEqual(settled.payload.preview_urls, previews);
});

test('durable acceptance returns while upstream is delayed and survives a lost acknowledgement', async t => {
  const gate = deferred(); let calls = 0;
  const {store,service} = await harness(t,{execute: async () => { calls++; await gate.promise; return remoteResult; }});
  const ack = await service.submit(submission());
  assert.match(ack.task_id,/^job-/);
  assert.equal(ack.status,'queued');
  assert.equal((await store.get(ack.task_id)).requestId,'req-1');
  assert.equal((await service.lookupRequest('req-1','owner-a')).task_id,ack.task_id);
  const replay = await service.submit(submission());
  assert.equal(replay.task_id,ack.task_id);
  gate.resolve();
  await waitFor(async () => (await service.get(ack.task_id,'owner-a')).status === 'succeeded');
  assert.equal(calls,1);
});

test('concurrent identical requests execute once and changed content returns conflict', async t => {
  let calls=0;
  const {service}=await harness(t,{execute:async()=>{calls++;return remoteResult;}});
  const acks=await Promise.all(Array.from({length:12},()=>service.submit(submission())));
  assert.equal(new Set(acks.map(a=>a.task_id)).size,1);
  await waitFor(async () => (await service.get(acks[0].task_id,'owner-a')).status==='succeeded');
  assert.equal(calls,1);
  await assert.rejects(service.submit(submission({body:{prompt:'changed',clientRequestId:'req-1'}})),e=>e.status===409);
});

test('task and request lookups are isolated by owner', async t => {
  const {service}=await harness(t,{execute:async()=>remoteResult});
  const ack=await service.submit(submission());
  await assert.rejects(service.get(ack.task_id,'owner-b'),e=>e.status===404);
  await assert.rejects(service.lookupRequest('req-1','owner-b'),e=>e.status===404);
  const other=await service.submit(submission({userId:'owner-b'}));
  assert.notEqual(other.task_id,ack.task_id);
});

test('recovery list filters UI mode before limiting newer jobs from the other UI', async t => {
  const {store,service}=await harness(t);
  await service.stop();
  const createdAt=Date.now();
  await store.admit({taskId:'job-canvas-old',userId:'owner-a',requestId:'canvas-old',uiMode:'canvas',createdAt:new Date(createdAt).toISOString(),status:'queued'},{body:{prompt:'canvas'}});
  await Promise.all(Array.from({length:100},(_,i)=>fs.writeFile(path.join(store.jobsDir,`job-classic-${i}.json`),JSON.stringify({taskId:`job-classic-${i}`,userId:'owner-a',requestId:`classic-${i}`,uiMode:'classic',createdAt:new Date(createdAt+i+1).toISOString(),status:'queued'}))));
  const jobs=await service.list('owner-a',{uiMode:'canvas',limit:100});
  assert.deepEqual(jobs.map(job=>job.task_id),['job-canvas-old']);
});

test('public recovery list reads only projected metadata and preserves every visible result', async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'image-job-projection-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const job={taskId:'job-projection',requestId:'projection',userId:'owner-a',uiMode:'canvas',
    status:'succeeded',progress:100,createdAt:'2026-10-16T01:00:00.000Z',completedAt:'2026-10-16T01:01:00.000Z',
    resultUrls:['/original-one.png','/original-two.png'],previewUrl:'/preview-one.webp',storageStatus:'pending',
    billing:{points:2},prompt:'a bird',model:'test',clientLiveTaskIds:['node-one','node-two'],
    payload:{preview_urls:['/preview-one.webp','/preview-two.webp'],raw:'x'.repeat(2*1024*1024)},
    images:['unused-large-value'],results:['unused-large-value']};
  const statements=[];
  const pool={execute:async(sql,params=[])=>{
    statements.push({sql,params});
    if(/CREATE TABLE/.test(sql))return[{}];
    if(/SELECT job_json FROM/.test(sql))return[[{job_json:job}]];
    if(/SELECT JSON_SET\(/.test(sql)){
      const {payload,images,results,...metadata}=job;
      return[[{job_json:{...metadata,payload:{preview_urls:payload.preview_urls}}}]];
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }};
  const store=createImageJobStore({root,useMySql:true,pool});
  const service=createImageJobService({store});
  const expected=await service.get(job.taskId,job.userId);
  const jobs=await service.list(job.userId,{uiMode:'canvas'});
  assert.deepEqual(jobs,[{...expected,ui_mode:'canvas',client_live_task_ids:job.clientLiveTaskIds}]);
  const listing=statements.at(-1);
  assert.match(listing.sql,/SELECT JSON_SET\(JSON_REMOVE\(job_json,/,'large JSON must be projected inside MySQL, before transfer');
  assert.match(listing.sql,/'\$\.payload'/);
  assert.match(listing.sql,/'\$\.images'/);
  assert.match(listing.sql,/'\$\.results'/);
  assert.match(listing.sql,/JSON_EXTRACT\(job_json, '\$\.payload\.preview_urls'\)/);
  assert.match(listing.sql,/WHERE user_id = \?.*ORDER BY created_at_ms DESC LIMIT 100/);
  assert.deepEqual(listing.params,['owner-a','canvas']);
  const internal=await store.list({userId:job.userId});
  assert.equal(internal[0].payload.raw.length,2*1024*1024,'internal recovery must retain the complete payload');
  assert.match(statements.at(-1).sql,/^SELECT job_json FROM/);
});

test('concurrent recovery requests share one read per owner and retry after settlement', async () => {
  const reads=[];
  const store={list:options=>{const gate=deferred();reads.push({options,gate});return gate.promise;}};
  const service=createImageJobService({store});
  const first=service.list('owner-a',{uiMode:'canvas',limit:'100'});
  const second=service.list('owner-a',{uiMode:'canvas',limit:100});
  const otherOwner=service.list('owner-b',{uiMode:'canvas',limit:100});
  const otherUi=service.list('owner-a',{uiMode:'classic',limit:100});
  const pending=service.list('owner-a',{uiMode:'canvas',status:'pending',limit:100});
  assert.equal(reads.length,4,'same owner/filter must share only the in-flight database read');
  for(const {gate} of reads)gate.resolve([]);
  await Promise.all([first,second,otherOwner,otherUi,pending]);
  const fresh=service.list('owner-a',{uiMode:'canvas',limit:100});
  assert.equal(reads.length,5,'a completed list must never become a stale recovery cache');
  reads.at(-1).gate.resolve([]);await fresh;
});

test('a failed shared recovery read is released so the next request can recover', async () => {
  let reads=0;const gate=deferred();
  const service=createImageJobService({store:{list:()=>++reads===1?gate.promise:Promise.resolve([])}});
  const first=service.list('owner-a');
  const second=service.list('owner-a');
  const results=Promise.allSettled([first,second]);
  gate.resolve(Promise.reject(new Error('database temporarily unavailable')));
  assert.deepEqual((await results).map(result=>result.status),['rejected','rejected']);
  assert.deepEqual(await service.list('owner-a'),[]);
  assert.equal(reads,2);
});

test('failed generation stores one compensation and rejects success with no image', async t => {
  let refunds=0;
  const {store,service}=await harness(t,{execute:async (job,body,context)=>{await context.persist({accountId:'acc',chargeId:'charge'});return {status:'succeeded'};},compensate:async()=>{refunds++;}});
  const ack=await service.submit(submission());
  await waitFor(async ()=>(await service.get(ack.task_id,'owner-a')).status==='failed');
  await service.reconcile(); await service.reconcile();
  assert.equal(refunds,1);
  assert.match((await store.get(ack.task_id)).error,/image|图片/i);
});

test('restart resumes queued requests but compensates an uncertain running request without replay',async t=>{
  let calls=0,refunds=0;
  const {store,service}=await harness(t,{execute:async()=>{calls++;return remoteResult;},compensate:async()=>{refunds++;}});
  await service.stop();
  const base={userId:'owner-a',endpoint:'/api/generate',createdAt:Date.now(),deadlineAt:Date.now()+10000};
  await store.admit({...base,taskId:'job-queued',requestId:'queued',fingerprint:'a',status:'queued'},{body:{prompt:'queued'}});
  await store.admit({...base,taskId:'job-running',requestId:'running',fingerprint:'b',status:'running',chargeId:'charge',accountId:'acc'},{body:{prompt:'running'}});
  const restart=createImageJobService({store,execute:async()=>{calls++;return remoteResult;},compensate:async()=>{refunds++;},pollIntervalMs:10});
  t.after(()=>restart.stop());
  await restart.start();
  await waitFor(async ()=>(await restart.get('job-queued','owner-a')).status==='succeeded');
  assert.equal((await restart.get('job-running','owner-a')).status,'failed');
  assert.equal(calls,1);assert.equal(refunds,1);
  await restart.reconcile();assert.equal(refunds,1);
});

test('native upstream task is durable and polled after restart',async t=>{
  const {store,service}=await harness(t,{execute:async()=>({task_id:'native-7',status:'processing'}),poll:async()=>({status:'processing'})});
  const ack=await service.submit(submission());
  await waitFor(async ()=>(await store.get(ack.task_id)).innerTaskId==='native-7');
  await service.stop();
  const restarted=createImageJobService({store,execute:async()=>assert.fail('native task must not resubmit'),poll:async()=>remoteResult,pollIntervalMs:10});
  t.after(()=>restarted.stop()); await restarted.start();
  await waitFor(async ()=>(await restarted.get(ack.task_id,'owner-a')).status==='succeeded');
});

test('remote asset callback cannot be overwritten by task finalization and settlement errors preserve success',async t=>{
  const assets={prepare:async({onSaved})=>{await onSaved({payload:{images:['/saved.png']},resultUrls:['/saved.png'],previewUrl:'/thumb.webp',storageStatus:'saved'});return {payload:remoteResult,resultUrls:remoteResult.images,storageStatus:'pending'};}};
  const {store,service}=await harness(t,{execute:async()=>remoteResult,assets,settleSuccess:async()=>{throw new Error('database unavailable');}});
  const ack=await service.submit(submission());
  await waitFor(async ()=>(await service.get(ack.task_id,'owner-a')).status==='succeeded');
  const result=await service.get(ack.task_id,'owner-a');
  assert.equal(result.storage_status,'saved'); assert.deepEqual(result.images,['/saved.png']);
  assert.equal((await store.get(ack.task_id)).settlementPending,true);
});

test('bounded queue and request bytes reject excess without starting upstream',async t=>{
  const gate=deferred();
  const {service}=await harness(t,{execute:async()=>{await gate.promise;return remoteResult;},concurrency:1,maxQueued:1,maxRequestBytes:1000});
  const ack=await service.submit(submission());
  await waitFor(async ()=>(await service.get(ack.task_id,'owner-a')).status==='processing');
  await service.submit(submission({body:{prompt:'second',clientRequestId:'req-2'}}));
  await assert.rejects(service.submit(submission({body:{prompt:'third',clientRequestId:'req-3'}})),e=>e.status===429);
  await assert.rejects(service.submit(submission({body:{prompt:'x'.repeat(2000),clientRequestId:'req-big'}})),e=>e.status===413);
  gate.resolve();
});

test('completed job metadata and polling never retain inline image bytes or request credentials',async t=>{
  const inline='data:image/png;base64,AAAA';
  const assets={prepare:async()=>({payload:{images:['/stored.png']},resultUrls:['/stored.png'],storageStatus:'saved'})};
  const {store,service}=await harness(t,{execute:async()=>({images:[inline]}),assets,logger:{warn:entry=>console.error(entry)}});
  const ack=await service.submit(submission({headers:{authorization:'Bearer private-key'}}));
  await waitFor(async ()=>(await service.get(ack.task_id,'owner-a')).status==='succeeded');
  const serialized=JSON.stringify(await store.get(ack.task_id))+JSON.stringify(await service.get(ack.task_id,'owner-a'));
  assert.equal(serialized.includes('AAAA'),false);assert.equal(serialized.includes('private-key'),false);
  await assert.rejects(store.readRequest(ack.task_id),e=>e.code==='ENOENT');
});

test('file metadata retries a transient Windows rename lock without failing admission',async t=>{
  const {store,service}=await harness(t);
  await service.stop();
  const rename=fs.rename;let attempts=0;
  fs.rename=async(source,target)=>{
    if(path.basename(target)==='job-rename.json' && attempts++<7)throw Object.assign(new Error('temporary Windows file lock'),{code:'EPERM'});
    return rename(source,target);
  };
  try {
    await store.admit({taskId:'job-rename',requestId:'rename',userId:'owner-a',status:'queued'},{body:{prompt:'rename'}});
    assert.equal((await store.get('job-rename')).status,'queued');
    assert.ok(attempts>=8 && attempts<=13,'retries injected locks and any additional OS lock within its bounded window');
  } finally {fs.rename=rename;}
});

test('outcome recovery cannot overwrite a newer completed asset publication',async t=>{
  const {store,service}=await harness(t);
  await service.stop();
  const id='job-outcome-race';
  await store.admit({taskId:id,requestId:'outcome-race',userId:'owner-a',status:'running'},{body:{prompt:'race'}});
  await store.saveOutcome(id,{status:'succeeded',resultUrls:[],storageStatus:'failed',settlementPending:true});
  const readFile=fs.readFile,gate=deferred();let held=false;
  fs.readFile=async(file,...args)=>{
    const bytes=await readFile(file,...args);
    if(!held && String(file)===path.join(store.root,'outcomes',`${id}.json`)){held=true;await gate.promise;}
    return bytes;
  };
  const recovery=store.recoverOutcomes();
  let completion;
  try {
    await waitFor(()=>held);
    completion=(async()=>{
      const final={status:'succeeded',resultUrls:['/generated-assets/final.png'],storageStatus:'saved',settlementPending:false};
      await store.saveOutcome(id,final);await store.update(id,final);await store.clearOutcome(id);
    })();
    await Promise.race([completion,new Promise(resolve=>setTimeout(resolve,500))]);
    gate.resolve();await Promise.all([recovery,completion]);
    const job=await store.get(id);
    assert.deepEqual(job.resultUrls,['/generated-assets/final.png']);
    assert.equal(job.storageStatus,'saved');assert.equal(job.settlementPending,false);
  } finally {gate.resolve();await Promise.allSettled([recovery,completion]);fs.readFile=readFile;}
});

test('maintenance dynamically skips a confirmation created after its journal scan starts',async t=>{
  const prepareGate=deferred(),scanGate=deferred();let preparing=false,scanning=false;
  const {store,service}=await harness(t,{assets:{prepare:async()=>{preparing=true;await prepareGate.promise;return {resultUrls:['/generated-assets/final.png'],storageStatus:'saved'};}}});
  await service.stop();
  await store.admit({taskId:'job-live-outcome',requestId:'live-outcome',userId:'owner-a',status:'running'},{body:{prompt:'live'}});
  const readdir=fs.readdir;
  fs.readdir=async(directory,...args)=>{
    if(!scanning && String(directory)===path.join(store.root,'outcomes')){scanning=true;await scanGate.promise;}
    return readdir(directory,...args);
  };
  const reconciliation=service.reconcile();let completion;
  try {
    await waitFor(()=>scanning);
    completion=service.processPayload('job-live-outcome',{images:['data:image/png;base64,AAAA']},await store.get('job-live-outcome'));
    await waitFor(()=>preparing);scanGate.resolve();await reconciliation;
    assert.equal((await store.get('job-live-outcome')).status,'running','an in-flight confirmation must not become a storage failure');
    prepareGate.resolve();await completion;
    assert.deepEqual((await service.get('job-live-outcome','owner-a')).images,['/generated-assets/final.png']);
  } finally {scanGate.resolve();prepareGate.resolve();await Promise.allSettled([reconciliation,completion]);fs.readdir=readdir;}
});

test('production configured metadata uses database uniqueness and never stores reference body in a database row',async t=>{
  const root=await fs.mkdtemp(path.join(process.env.IMAGE_JOB_TEST_ROOT||os.tmpdir(),'image-job-sql-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const jobs=new Map();const statements=[];
  const pool={execute:async(sql,params=[])=>{
    statements.push({sql,params});
    if(/CREATE TABLE/.test(sql))return[{}];
    if(/INSERT INTO image_jobs/.test(sql)){
      const job=JSON.parse(params[7]);
      if([...jobs.values()].some(j=>j.userId===job.userId&&j.requestId===job.requestId))throw Object.assign(new Error('duplicate'),{code:'ER_DUP_ENTRY'});
      jobs.set(job.taskId,job);return[{}];
    }
    if(/SELECT job_json FROM image_jobs WHERE task_id/.test(sql))return[[...(jobs.has(params[0])?[{job_json:JSON.stringify(jobs.get(params[0]))}]:[])]];
    if(/SELECT job_json FROM image_jobs WHERE user_id/.test(sql))return[[...[...jobs.values()].filter(j=>j.userId===params[0]&&j.requestId===params[1]).map(j=>({job_json:JSON.stringify(j)}))]];
    if(/SELECT job_json FROM image_jobs/.test(sql))return[[...[...jobs.values()].map(j=>({job_json:JSON.stringify(j)}))]];
    if(/UPDATE image_jobs/.test(sql)){jobs.set(params[3],JSON.parse(params[2]));return[{}];}
    return[{}];
  }};
  const store=createImageJobStore({root,useMySql:true,pool});
  const data={userId:'owner',requestId:'request',taskId:'job-sql',endpoint:'/api/edit',fingerprint:'fp',status:'queued'};
  const first=await store.admit(data,{body:{image:'data:image/png;base64,PRIVATE'}});
  const second=await store.admit({...data,taskId:'job-second'},{body:{image:'data:image/png;base64,PRIVATE'}});
  assert.equal(second.job.taskId,first.job.taskId);assert.equal(second.duplicate,true);
  assert.equal((await store.get('job-sql')).userId,'owner');
  assert.equal(statements.some(item=>/CREATE TABLE/.test(item.sql)),true);
  assert.equal(JSON.stringify(statements).includes('PRIVATE'),false);
  await store.list({userId:'owner',uiMode:'classic',limit:100,descending:true});
  const query=statements.at(-1);
  assert.match(query.sql,/JSON_UNQUOTE\(JSON_EXTRACT\(job_json, '\$\.uiMode'\)\) = \?.*LIMIT 100/);
  assert.deepEqual(query.params,['owner','classic']);
});

test('successful provider result survives metadata settlement failure and restart without compensation',async t=>{
  let refunds=0;
  const {root,store,service}=await harness(t,{execute:async()=>remoteResult,compensate:async()=>{refunds++;}});
  const update=store.update;let failWrites=true;
  store.update=async(id,patch)=>{
    const current=await store.get(id);const result=typeof patch==='function'?await patch(current):patch;
    if(result.status==='succeeded'&&failWrites)throw new Error('metadata database offline');
    return update(id,patch);
  };
  const ack=await service.submit(submission());
  await waitFor(async()=>['succeeded','failed'].includes((await service.get(ack.task_id,'owner-a')).status));
  assert.equal((await service.get(ack.task_id,'owner-a')).status,'succeeded');assert.equal(refunds,0);
  await service.stop();failWrites=false;
  const newStore=createImageJobStore({root,useMySql:false});
  const restarted=createImageJobService({store:newStore,execute:async()=>assert.fail('success must not be repeated'),compensate:async()=>{refunds++;}});
  t.after(()=>restarted.stop());await restarted.start();
  assert.equal((await restarted.get(ack.task_id,'owner-a')).status,'succeeded');assert.equal(refunds,0);
});

test('image save errors preserve generated success and never refund generation',async t=>{
  let refunds=0;
  const assets={prepare:async()=>{throw new Error('disk unavailable');}};
  const {service}=await harness(t,{execute:async()=>remoteResult,assets,compensate:async()=>{refunds++;}});
  const ack=await service.submit(submission());await waitFor(async()=>(await service.get(ack.task_id,'owner-a')).status==='succeeded');
  const result=await service.get(ack.task_id,'owner-a');assert.equal(result.storage_status,'failed');assert.equal(refunds,0);assert.deepEqual(result.images,remoteResult.images);
});

test('stalled native polling terminates at deadline and compensates once',async t=>{
  let refunds=0,polls=0,abortedAt;
  const {store,service}=await harness(t,{deadlineMs:3000,execute:async()=>({task_id:'native-stall',status:'processing'}),poll:async(job,context)=>{
    polls++;
    return new Promise(resolve=>context.signal.addEventListener('abort',()=>{abortedAt=Date.now();resolve({status:'processing'});},{once:true}));
  },compensate:async()=>{refunds++;}});
  const ack=await service.submit(submission());
  await waitFor(()=>polls>0);
  const deadline=(await store.get(ack.task_id)).deadlineAt;
  await waitFor(async()=>(await service.get(ack.task_id,'owner-a')).status==='failed');
  assert.ok(abortedAt>=deadline-10,'native transport aborted at its durable deadline');
  assert.ok(abortedAt<deadline+1000,'deadline does not wait for stalled upstream response');
  await service.reconcile();assert.equal(refunds,1);
});

test('restart resumes pending remote image save without generating another image',async t=>{
  let saves=0;
  const {store,service}=await harness(t,{execute:async()=>remoteResult});
  const ack=await service.submit(submission());await waitFor(async()=>(await service.get(ack.task_id,'owner-a')).status==='succeeded');await service.stop();
  await store.update(ack.task_id,{storageStatus:'pending'});
  const assets={cleanup:async()=>{},prepare:async({onSaved})=>{saves++;await onSaved({payload:{images:['/resaved.png']},resultUrls:['/resaved.png'],storageStatus:'saved'});return {resultUrls:remoteResult.images,storageStatus:'pending'};}};
  const restart=createImageJobService({store,assets,execute:async()=>assert.fail('asset recovery must not generate')});
  t.after(()=>restart.stop());await restart.start();
  await waitFor(async()=>(await restart.get(ack.task_id,'owner-a')).storage_status==='saved');
  assert.equal(saves,1);assert.deepEqual((await restart.get(ack.task_id,'owner-a')).images,['/resaved.png']);
});

test('saved original and preview publication retries after a metadata outage without downloading again',async t=>{
  let callback,prepares=0,executions=0,refunds=0;
  const assets={cleanup:async()=>{},prepare:async({onSaved,resultUrls})=>{prepares++;callback=onSaved;return {resultUrls,storageStatus:'pending'};}};
  const {store,service}=await harness(t,{assets,execute:async()=>{executions++;return remoteResult;},compensate:async()=>{refunds++;}});
  const ack=await service.submit(submission());
  await waitFor(async()=>{const job=await store.get(ack.task_id);return job.status==='succeeded'&&!job.settlementPending;});
  await service.stop();
  const update=store.update;let offline=true;
  store.update=async(id,patch)=>{if(offline)throw new Error('metadata temporarily unavailable');return update(id,patch);};
  await callback({resultUrls:['/saved-original.png'],previewUrl:'/saved-preview.webp',storageStatus:'saved'});
  assert.equal((await store.get(ack.task_id)).storageStatus,'pending');
  offline=false;await service.reconcile();await service.reconcile();
  const job=await store.get(ack.task_id);
  assert.equal(job.storageStatus,'saved');assert.deepEqual(job.resultUrls,['/saved-original.png']);assert.equal(job.previewUrl,'/saved-preview.webp');
  assert.equal(prepares,1);assert.equal(executions,1);assert.equal(refunds,0);
});

test('saved asset publication journal restores the latest preview after restart without redownloading',async t=>{
  let callback,prepares=0;
  const assets={cleanup:async()=>{},prepare:async({onSaved,resultUrls})=>{prepares++;callback=onSaved;return {resultUrls,storageStatus:'pending'};}};
  const {root,store,service}=await harness(t,{assets,execute:async()=>remoteResult});
  const ack=await service.submit(submission());
  await waitFor(async()=>{const job=await store.get(ack.task_id);return job.status==='succeeded'&&!job.settlementPending;});
  await service.stop();
  store.update=async()=>{throw new Error('database offline during saved asset publication');};
  await callback({resultUrls:['/saved-original.png'],storageStatus:'saved'});
  await callback({resultUrls:['/saved-original.png'],previewUrl:'/saved-preview.webp',storageStatus:'saved'});
  const journal=await fs.readFile(path.join(root,'asset-updates',`${ack.task_id}.json`),'utf8');
  assert.equal(journal.includes('base64'),false);assert.match(journal,/saved-preview/);
  const restored=createImageJobStore({root,useMySql:false});let settled;
  const restart=createImageJobService({store:restored,assets:{cleanup:async()=>{},prepare:async()=>assert.fail('saved originals must not be downloaded again')},execute:async()=>assert.fail('confirmed generation must not repeat'),settleSuccess:async job=>{settled=job;}});
  t.after(()=>restart.stop());await restart.start();
  const job=await restored.get(ack.task_id);
  assert.equal(job.storageStatus,'saved');assert.deepEqual(job.resultUrls,['/saved-original.png']);assert.equal(job.previewUrl,'/saved-preview.webp');
  assert.equal(settled.previewUrl,'/saved-preview.webp');assert.equal(prepares,1);
  assert.deepEqual(await fs.readdir(path.join(root,'asset-updates')),[]);
  await restart.stop();
});

test('confirmed images cannot be refunded when the first metadata read after upstream throws',async t=>{
  let failRead=true,refunds=0,store;
  const h=await harness(t,{execute:async()=>{
    const get=store.get;store.get=async id=>{if(failRead){failRead=false;throw new Error('first completion read lost database');}return get(id);};return remoteResult;
  },compensate:async()=>{refunds++;}});
  const {root,service}=h;store=h.store;
  const ack=await service.submit(submission());
  await waitFor(async()=>{try{return ['succeeded','failed'].includes((await service.get(ack.task_id,'owner-a')).status);}catch{return false;}});
  assert.equal((await service.get(ack.task_id,'owner-a')).status,'succeeded');assert.equal(refunds,0);
  await service.stop();
  const fresh=createImageJobStore({root,useMySql:false});const restart=createImageJobService({store:fresh,execute:async()=>assert.fail('no duplicate'),compensate:async()=>{refunds++;}});
  t.after(()=>restart.stop());await restart.start();assert.equal((await restart.get(ack.task_id,'owner-a')).status,'succeeded');assert.equal(refunds,0);
});

test('transient startup failure can be retried and queued jobs resume',async t=>{
  const root=await fs.mkdtemp(path.join(process.env.IMAGE_JOB_TEST_ROOT||os.tmpdir(),'image-job-boot-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const store=createImageJobStore({root,useMySql:false});await store.init();
  await store.admit({userId:'owner-a',requestId:'boot',taskId:'job-boot',status:'queued',endpoint:'/api/generate',deadlineAt:Date.now()+10000},{body:{prompt:'boot'}});
  const init=store.init;let attempts=0;store.init=async()=>{if(attempts++===0)throw new Error('database temporarily unavailable');return init();};
  const service=createImageJobService({store,execute:async()=>remoteResult});t.after(()=>service.stop());
  await assert.rejects(service.start(),/temporarily unavailable/);await service.start();
  await waitFor(async()=>(await service.get('job-boot','owner-a')).status==='succeeded');
});

test('deadline aborts physical execution before another queued job occupies its worker slot',async t=>{
  let executions=0,maxExecutions=0,aborts=0,started=0;
  const {store,service}=await harness(t,{concurrency:1,deadlineMs:2000,execute:async(job,body,context)=>{
    started++;
    executions++;maxExecutions=Math.max(maxExecutions,executions);
    if(body.prompt==='second'){executions--;return remoteResult;}
    return new Promise((resolve,reject)=>{
      context.signal.addEventListener('abort',()=>{aborts++;setTimeout(()=>{executions--;reject(new Error('transport aborted'));},100);},{once:true});
    });
  }});
  const first=await service.submit(submission());
  await waitFor(()=>started===1);
  const second=await service.submit(submission({body:{prompt:'second',clientRequestId:'physical-second'}}));
  await store.update(second.task_id,{deadlineAt:Date.now()+10000});
  await waitFor(()=>started===2);
  await waitFor(async()=>(await service.get(second.task_id,'owner-a')).status==='succeeded');
  assert.equal((await service.get(first.task_id,'owner-a')).status,'failed');
  assert.equal(maxExecutions,1);assert.equal(aborts,1);
});

test('success reconciliation never overwrites charge and record associations persisted by execution',async t=>{
  const {store,service}=await harness(t,{execute:async(job,body,context)=>{await context.persist({accountId:'account-live',chargeId:'charge-live',generationRecordId:'record-live'});return remoteResult;}});
  const update=store.update;let rejectCompletion=true;
  store.update=async(id,patch)=>{const value=typeof patch==='function'?await patch(await store.get(id)):patch;if(value.status==='succeeded'&&rejectCompletion)throw new Error('database offline');return update(id,patch);};
  const ack=await service.submit(submission());await waitFor(async()=>(await service.get(ack.task_id,'owner-a')).status==='succeeded');
  rejectCompletion=false;await service.reconcile();
  const job=await store.get(ack.task_id);assert.equal(job.accountId,'account-live');assert.equal(job.chargeId,'charge-live');assert.equal(job.generationRecordId,'record-live');
});

test('confirmed result is durably journaled before image save finishes',async t=>{
  const gate=deferred();let entered=false;
  const assets={prepare:async()=>{entered=true;await gate.promise;return {resultUrls:remoteResult.images,storageStatus:'pending'};}};
  const {root,service}=await harness(t,{execute:async()=>remoteResult,assets});
  t.after(()=>gate.resolve());
  const ack=await service.submit(submission());await waitFor(()=>entered);
  const fresh=createImageJobStore({root,useMySql:false});let refunds=0;
  const restarted=createImageJobService({store:fresh,execute:async()=>assert.fail('no replay of confirmed image'),compensate:async()=>{refunds++;}});
  t.after(()=>restarted.stop());await restarted.start();
  try{assert.equal((await restarted.get(ack.task_id,'owner-a')).status,'succeeded');assert.equal(refunds,0);}
  finally{gate.resolve();}
});

test('per-user concurrency leaves workers free for other users',async t=>{
  const gate=deferred();const started=[];
  const {service}=await harness(t,{concurrency:3,userConcurrency:2,execute:async job=>{started.push(job.userId);await gate.promise;return remoteResult;}});
  for(let i=0;i<4;i++)await service.submit(submission({body:{prompt:`a${i}`,clientRequestId:`a-${i}`}}));
  await service.submit(submission({userId:'owner-b',body:{prompt:'b',clientRequestId:'b-0'}}));
  await waitFor(()=>started.length===3);
  await new Promise(r=>setTimeout(r,60));
  assert.deepEqual([...started].sort(),['owner-a','owner-a','owner-b']);
  gate.resolve();
  await waitFor(()=>started.length===5);
});

test('per-user pending limit rejects one user without blocking others',async t=>{
  const gate=deferred();
  const {service}=await harness(t,{concurrency:1,userMaxQueued:2,execute:async()=>{await gate.promise;return remoteResult;}});
  await service.submit(submission({body:{prompt:'1',clientRequestId:'u-1'}}));
  await service.submit(submission({body:{prompt:'2',clientRequestId:'u-2'}}));
  await assert.rejects(service.submit(submission({body:{prompt:'3',clientRequestId:'u-3'}})),e=>e.status===429 && e.code==='USER_QUEUE_FULL' && /2 张图片/.test(e.message));
  const other=await service.submit(submission({userId:'owner-b',body:{prompt:'b',clientRequestId:'b-1'}}));
  assert.equal(other.status,'queued');
  gate.resolve();
});

test('personal queue refusal takes priority when global and user limits are both full',async t=>{
  const {service}=await harness(t,{maxQueued:1,userMaxQueued:1});
  await service.stop();
  const first=submission();
  const ack=await service.submit(first);
  assert.equal((await service.submit(first)).task_id,ack.task_id,'duplicate requests keep the existing receipt');
  await assert.rejects(service.submit(submission({body:{prompt:'extra',clientRequestId:'extra'}})),error=>error.status===429&&error.code==='USER_QUEUE_FULL');
});

test('native queue and reported progress survive polling without replacing the route task token',async t=>{
  const {store,service}=await harness(t);
  await service.stop();
  await store.admit({taskId:'job-progress',userId:'owner-a',requestId:'progress',status:'running'},{body:{prompt:'progress'}});
  await service.processPayload('job-progress',{task_id:'encoded-route-token',state:'queued',progress:'25%'});
  assert.equal((await service.get('job-progress','owner-a')).status,'queued');
  assert.equal((await service.get('job-progress','owner-a')).progress,25);
  await service.processPayload('job-progress',{task_id:'provider-raw-id',data:{state:'processing',percentage:65}});
  assert.equal((await store.get('job-progress')).innerTaskId,'encoded-route-token');
  assert.equal((await service.get('job-progress','owner-a')).status,'processing');
  assert.equal((await service.get('job-progress','owner-a')).progress,65);
  await service.processPayload('job-progress',{state:'processing',progress:40});
  await service.processPayload('job-progress',{state:'processing',progress:100});
  assert.equal((await service.get('job-progress','owner-a')).progress,65);
  assert.equal((await store.get('job-progress')).status,'running');
  await service.processPayload('job-progress',{state:'failed',progress:100,url:'https://example.com/input.png'});
  assert.equal((await service.get('job-progress','owner-a')).status,'failed');
});
