const test = require('node:test');
const assert = require('node:assert/strict');
const {createOperationsDashboard, classifyFailure, safeTask} = require('./operationsDashboard.cjs');

const fixture = () => {
  let now=Date.parse('2026-10-19T08:00:00Z'), queries=0, provider=0;
  const facts=[], events=[], incidents=[];
  const runtime={generatedAt:new Date(now).toISOString(),limits:{concurrency:48,userConcurrency:6},active:48,localQueued:3,upstreamQueued:5,tasks:[]};
  const coverage={available:true,startedAt:new Date(now).toISOString(),lastCollectedAt:new Date(now).toISOString(),history:'collected'};
  const store={init:async()=>{},getCoverage:()=>coverage,upsertTaskFact:async(id,fact)=>facts.push(fact),appendEvent:async event=>events.push(event),refreshAggregates:async()=>queries++,getFailureSummary:()=>({total:0,succeeded:0,failed:0,successRate:null,affectedUsers:0,causes:[],routes:[]}),getTrends:()=>({items:[],window:'1h'}),listIncidents:()=>({items:incidents}),upsertIncident:async incident=>incidents.push(incident),pruneExpired:async()=>{},listTaskFacts:async filters=>({items:[safeTask({taskId:'a',status:'failed',errorSummary:'Bearer secret',prompt:'hidden'})],nextCursor:null,filters}),getTaskFact:async()=>null};
  const metrics={collect:async()=>({generatedAt:new Date(now).toISOString(),host:{available:false},disk:{totalBytes:1000,freeBytes:50}}),getSnapshot:()=>({}),close:()=>{}};
  const dashboard=createOperationsDashboard({store,metrics,getRuntime:()=>runtime,now:()=>now,readHostSnapshot:async()=>null});
  return {dashboard,store,runtime,facts,events,incidents,queries:()=>queries,advance:ms=>now+=ms};
};
test('shared collectors run independently of readers and mark stale values',async()=>{
  const f=fixture(); await f.dashboard.collect(); const queries=f.queries();
  for(let i=0;i<40;i++) { const summary=await f.dashboard.getSummary(); assert.equal(summary.runtime.active,48);assert.equal(summary.failures.successRate,null); }
  assert.equal(f.queries(),queries);f.advance(61000);assert.equal((await f.dashboard.getSummary()).freshness.stale,true);await f.dashboard.stop();
});
test('events preserve generated success despite storage failure and redact task fields',async()=>{
  const f=fixture();await f.dashboard.record({type:'storage',createdAt:'2026-10-19T08:00:00Z',task:{taskId:'job1',userId:'u1',status:'succeeded',storageStatus:'failed',settlementPending:true,error:'Bearer abcdef and https://host/asset?token=xyz',prompt:'private',headers:{Authorization:'private'}}});
  assert.equal(f.facts[0].status,'succeeded');assert.equal(f.facts[0].settlementStatus,'pending');
  assert.ok(!JSON.stringify(f.facts).includes('abcdef'));assert.ok(!JSON.stringify(f.events).includes('xyz'));assert.ok(!JSON.stringify(f.events).includes('private'));await f.dashboard.stop();
});
test('classifies capacity, upstream and persistence failures independently',()=>{
  assert.equal(classifyFailure({code:'USER_QUEUE_FULL',status:429}).category,'user_queue_full');
  assert.equal(classifyFailure({status:429}).category,'upstream_rate_limit');
  assert.equal(classifyFailure({status:503}).category,'upstream_service');
  assert.equal(classifyFailure({message:'socket timed out'}).category,'timeout');
  assert.equal(classifyFailure({message:'preview failed'},'preview').stage,'preview');
});
test('alerts use minimum samples and recover without page requests',async()=>{
  const f=fixture();f.store.getFailureSummary=()=>({routes:[{routeId:'r1',total:10,failed:3,affectedUsers:2}],successRate:70});
  await f.dashboard.collect();assert.ok(f.incidents.some(i=>i.category==='route_failure_rate'&&i.status==='active'));
  f.store.getFailureSummary=()=>({routes:[{routeId:'r1',total:10,failed:0}],successRate:100});
  await f.dashboard.collect();assert.ok(f.incidents.some(i=>i.category==='route_failure_rate'&&i.status==='recovered'));await f.dashboard.stop();
});
test('fresh collector cannot disguise stale scheduler or trend data',async()=>{
  const f=fixture();await f.dashboard.collect();f.advance(40000);await f.dashboard.collect();
  const summary=await f.dashboard.getSummary();assert.equal(summary.freshness.runtime.stale,true);assert.equal(summary.freshness.stale,true);
  f.advance(90000);assert.equal((await f.dashboard.getTrends({window:'1h'})).freshness.history.stale,true);await f.dashboard.stop();
});
test('fresh but invalid host snapshot is unavailable and valid snapshot sets provenance',async()=>{
  const f=fixture();const metrics={collect:async()=>({generatedAt:'2026-10-19T08:00:00Z',host:{available:false},coverage:{host:'unavailable'}}),close(){}};
  const invalid=createOperationsDashboard({store:f.store,metrics,getRuntime:()=>f.runtime,now:()=>Date.parse('2026-10-19T08:00:00Z'),readHostSnapshot:async()=>({generatedAt:'2026-10-19T08:00:00Z',cpuPercent:null,memoryTotalBytes:null,memoryAvailableBytes:null,containers:{app:null,mysql:null}})});
  await invalid.collect();assert.equal((await invalid.getSummary()).resources.host.available,false);assert.equal((await invalid.getSummary()).resources.containers.available,false);await invalid.stop();
  const valid=createOperationsDashboard({store:f.store,metrics,getRuntime:()=>f.runtime,now:()=>Date.parse('2026-10-19T08:00:00Z'),readHostSnapshot:async()=>({generatedAt:'2026-10-19T08:00:00Z',cpuPercent:10,memoryTotalBytes:8*1024**3,memoryAvailableBytes:4*1024**3,containers:{app:'running',mysql:'running'}})});
  await valid.collect();assert.equal((await valid.getSummary()).resources.coverage.host,'host_snapshot');await valid.stop();
});
test('settlement errors retain safe summary and archival failure propagates for retry',async()=>{
  const f=fixture();await f.dashboard.record({type:'settlement',task:{taskId:'settlement-1',status:'succeeded',settlementPending:true},error:{error:'database unavailable',failureCode:'DB_OFFLINE'}});
  assert.equal(f.facts[0].errorSummary,'database unavailable');assert.equal(f.facts[0].failureCategory,'settlement_error');
  f.store.appendEvent=async()=>{throw Error('private credentials');};
  await assert.rejects(f.dashboard.record({type:'terminal',task:{taskId:'retry-me',status:'succeeded'}}),/persistence unavailable/);
  assert.match((await f.dashboard.getSummary()).coverage.collectionError,/补采/);await f.dashboard.stop();
});
test('three distinct hard auth failures trigger an alert, repeated task does not inflate',async()=>{
  const f=fixture();const event=id=>({type:'terminal',task:{taskId:id,userId:'u',routeId:'auth-route',status:'failed',httpStatus:401,error:'Unauthorized'}});
  await f.dashboard.record(event('one'));await f.dashboard.record(event('one'));await f.dashboard.record(event('two'));await f.dashboard.collect();
  assert.ok(!f.incidents.some(i=>i.category==='route_auth'));
  await f.dashboard.record(event('three'));await f.dashboard.collect();assert.ok(f.incidents.some(i=>i.category==='route_auth'));await f.dashboard.stop();
});

test('failure API reports the selected cached window age instead of the hot collector age',async()=>{
  const f=fixture();
  const coldAt='2026-10-19T08:00:00.000Z';
  f.store.getFailureSummary=({window}={})=>({generatedAt:window==='24h'?coldAt:null,total:0,routes:[]});
  await f.dashboard.collect();f.advance(10*60000);await f.dashboard.collect();
  const cold=await f.dashboard.getFailures({window:'24h'});
  assert.equal(cold.generatedAt,coldAt);
  assert.equal(cold.freshness.history.ageMs,10*60000);
  assert.equal(cold.freshness.history.stale,false);
  const uncollected=await f.dashboard.getFailures({window:'15m'});
  assert.equal(uncollected.generatedAt,null);
  assert.equal(uncollected.freshness.history.stale,true);
  f.advance(8*60000);await f.dashboard.collect();
  assert.equal((await f.dashboard.getFailures({window:'24h'})).freshness.history.stale,true);
  await f.dashboard.stop();
});

test('full event buffer rejects archival instead of acknowledging a dropped terminal snapshot',async()=>{
  const f=fixture();let release;
  const blocked=new Promise(resolve=>{release=resolve;});
  f.store.upsertTaskFact=async()=>blocked;
  const pending=Array.from({length:512},(_,i)=>f.dashboard.record({type:'terminal',task:{taskId:`buffer-${i}`,status:'succeeded'}}));
  try {
    await assert.rejects(f.dashboard.record({type:'terminal',task:{taskId:'must-retain',status:'succeeded'}}),/buffer full/i);
    assert.match((await f.dashboard.getSummary()).coverage.collectionError,/缓冲/);
  }finally{release();await Promise.allSettled(pending);await f.dashboard.stop();}
});
test('image cleanup failures, overdue originals and storage pressure raise alerts',async()=>{
  const f=fixture();
  f.runtime.storage={consecutiveFailures:3,lastError:'EACCES',overdueOriginals:12,originalTtlMs:3600000};
  await f.dashboard.collect();
  const active=f.incidents.filter(i=>i.status==='active');
  assert.ok(active.some(i=>i.fingerprint==='asset_cleanup'&&i.severity==='critical'));
  assert.ok(active.some(i=>i.fingerprint==='asset_overdue'));
  assert.ok(active.some(i=>i.fingerprint==='asset_pressure'));
  f.runtime.storage={consecutiveFailures:0,overdueOriginals:0,originalTtlMs:5*3600000};
  await f.dashboard.collect();
  assert.ok(f.incidents.some(i=>i.fingerprint==='asset_cleanup'&&i.status==='recovered'));
  await f.dashboard.stop();
});
