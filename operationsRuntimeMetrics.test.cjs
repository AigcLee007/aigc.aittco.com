const test=require('node:test');
const assert=require('node:assert/strict');
let metrics={};try {metrics=require('./operationsRuntimeMetrics.cjs');}catch(error){if(error.code!=='MODULE_NOT_FOUND')throw error;}

test('resource parsers report proc memory, CPU deltas, and cgroup unlimited explicitly',()=>{
  assert.equal(typeof metrics.parseMeminfo,'function');
  assert.deepEqual(metrics.parseMeminfo('MemTotal: 1000 kB\nMemAvailable: 400 kB\nMemFree: 1 kB\n'),{memoryTotalBytes:1024000,memoryAvailableBytes:409600});
  assert.equal(metrics.parseMeminfo('MemTotal: invalid'),null);
  assert.deepEqual(metrics.parseCpuStat('cpu 10 2 5 80 3 0 0 0 1 0\ncpu0 1'),{total:100,idle:83});
  assert.equal(metrics.cpuPercent({total:100,idle:83},{total:200,idle:133}),50);
  assert.equal(metrics.cpuPercent(null,{total:200,idle:133}),null);
  assert.equal(metrics.parseCgroupValue('max'),null);assert.equal(metrics.parseCgroupValue('2048\n'),2048);assert.equal(metrics.parseCgroupValue('-2'),null);
});

test('resource collector exposes synchronous cached snapshot and real process, host, cgroup and disk sources',async t=>{
  assert.equal(typeof metrics.createOperationsRuntimeMetrics,'function');
  let timestamp=Date.parse('2026-10-19T00:00:00Z'),cpu='cpu 10 0 10 80 0 0 0 0';const reads=[];
  const monitor={enable(){},disable(){},reset(){},percentile:()=>4e6};
  const collector=metrics.createOperationsRuntimeMetrics({storageRoot:'/storage',hostProcPath:'/host/proc',now:()=>timestamp,
    memoryUsage:()=>({rss:80,heapUsed:40}),uptime:()=>9,monitorEventLoopDelay:()=>monitor,
    readFile:async file=>{reads.push(file);if(file==='/host/proc/meminfo')return 'MemTotal: 1000 kB\nMemAvailable: 250 kB';if(file==='/host/proc/stat')return cpu;if(file==='/sys/fs/cgroup/memory.current')return '300';if(file==='/sys/fs/cgroup/memory.max')return 'max';throw new Error('missing');},
    statfs:async location=>{assert.equal(location,'/storage');return {bsize:1024,blocks:10,bavail:4};}});
  t.after(()=>collector.close());
  assert.equal(collector.getSnapshot().generatedAt,null);
  const first=await collector.collect();assert.equal(first.host.available,true);assert.equal(first.host.cpuPercent,null);assert.equal(first.host.memoryTotalBytes,1024000);
  timestamp+=1000;cpu='cpu 40 0 30 130 0 0 0 0';const second=await collector.collect();
  assert.equal(second.host.cpuPercent,50);assert.deepEqual(second.process,{rssBytes:80,heapUsedBytes:40,uptimeSeconds:9,eventLoopP95Ms:4});
  assert.equal(second.cgroup.memoryCurrentBytes,300);assert.equal(second.cgroup.memoryMaxBytes,null);assert.equal(second.coverage.cgroupMemoryLimit,'unlimited');
  assert.deepEqual(second.disk,{totalBytes:10240,freeBytes:4096});
  const before=reads.length;assert.equal(collector.getSnapshot().generatedAt,new Date(timestamp).toISOString());assert.equal(reads.length,before);
});

test('missing and invalid resource files are unavailable and never fabricated as host memory or CPU',async t=>{
  assert.equal(typeof metrics.createOperationsRuntimeMetrics,'function');
  const collector=metrics.createOperationsRuntimeMetrics({readFile:async()=>{throw new Error('ENOENT');},statfs:async()=>{throw new Error('missing');},hostProcPath:'/host/proc'});t.after(()=>collector.close());
  const result=await collector.collect();assert.deepEqual(result.host,{available:false,cpuPercent:null,memoryTotalBytes:null,memoryAvailableBytes:null});
  assert.deepEqual(result.cgroup,{memoryCurrentBytes:null,memoryMaxBytes:null});assert.deepEqual(result.disk,{totalBytes:null,freeBytes:null});assert.equal(result.coverage.host,'unavailable');
});

test('resource collection has a deadline for hanging disk and file readers',async t=>{
  assert.equal(typeof metrics.createOperationsRuntimeMetrics,'function');
  const collector=metrics.createOperationsRuntimeMetrics({readFile:()=>new Promise(()=>{}),statfs:()=>new Promise(()=>{}),collectionTimeoutMs:20});t.after(()=>collector.close());
  const start=Date.now();const result=await collector.collect();assert.ok(Date.now()-start<1000);assert.equal(result.disk.freeBytes,null);
});
