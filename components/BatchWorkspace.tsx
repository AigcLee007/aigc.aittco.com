import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Copy, Download, FileSpreadsheet, ImagePlus, LoaderCircle, MapPin, Pause, Play, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { ensureImageModelCatalogLoaded, getHiggsfieldImageOptions, getImageModelOptions, getImageModelSizeOptions, getImageModelById } from '../src/config/imageModels';
import { ensureImageRouteCatalogLoaded, getImageRouteById, getImageRoutesByModelFamily, getImageRoutePointCost } from '../src/config/imageRoutes';
import { assetStorage } from '../src/services/assetStorage';
import { parseExcelPreview, parsePromptFile } from '../src/utils/fileParser';
import type { BatchGenerationRecord, BatchGenerationSettings, BatchInputGroup, BatchMode, BatchTaskStatus } from '../src/services/batchGenerationTypes';
import { MAX_BATCH_OUTPUT_COUNT } from '../src/hooks/useBatchGeneration';

export interface BatchWorkspaceController {
  ownerId: string;
  loading: boolean;
  batches: BatchGenerationRecord[];
  activeBatchId: string | null;
  createBatch: (mode: BatchMode, settings: BatchGenerationSettings, title?: string) => Promise<string>;
  replaceGroups: (batchId: string, groups: BatchInputGroup[] | ((groups: BatchInputGroup[]) => BatchInputGroup[])) => Promise<void>;
  updateSettings: (batchId: string, updates: Partial<BatchGenerationSettings>, title?: string) => Promise<void>;
  getBatchRoutes: (mode: BatchMode, modelId: string, directKeyOnly: boolean) => ReturnType<typeof import('../src/services/batchGenerationOptions').getBatchRoutes>;
  getBatchSizes: (modelId: string, route: ReturnType<BatchWorkspaceController['getBatchRoutes']>[number] | undefined) => string[];
  startBatch: (batchId: string) => Promise<void>;
  pauseBatch: (batchId: string) => Promise<void>;
  retryTasks: (batchId: string, taskIds: string[]) => Promise<void>;
  duplicateBatch: (batchId: string) => Promise<string>;
  deleteBatch: (batchId: string) => Promise<void>;
}

const STATUS_LABEL: Record<BatchTaskStatus, string> = {
  pending: '待运行',
  submitting: '提交中',
  'awaiting-confirmation': '等待确认',
  queued: '排队中',
  running: '生成中',
  succeeded: '已完成',
  failed: '失败',
};

const createGroup = (prompt: string, outputCount: number, referenceAssetIds: string[] = []): BatchInputGroup => ({
  id: crypto.randomUUID(),
  prompt,
  referenceAssetIds,
  outputCount,
  enabled: true,
});

const statusColor = (status: BatchTaskStatus) => status === 'succeeded'
  ? 'text-emerald-400' : status === 'failed' ? 'text-rose-400' : status === 'running' || status === 'submitting'
    ? 'text-cyan-300' : 'text-zinc-400';

export const BatchWorkspace: React.FC<{
  controller: BatchWorkspaceController;
  initialSettings: BatchGenerationSettings;
  onClose: () => void;
  onLocateNode: (nodeId: string) => void;
  onDownloadResult?: (src: string, prompt: string, nodeId: string) => void;
}> = ({ controller, initialSettings, onClose, onLocateNode, onDownloadResult }) => {
  const [selectedBatchId, setSelectedBatchId] = useState('');
  const [referencePreviews, setReferencePreviews] = useState<Record<string, string>>({});
  const previewCache = useRef<Record<string, string>>({});
  const [referenceMode, setReferenceMode] = useState<'independent' | 'shared'>('independent');
  const [sharedReferences, setSharedReferences] = useState<string[]>([]);
  const [sharedPrompt, setSharedPrompt] = useState('');
  const [importPreview, setImportPreview] = useState<Awaited<ReturnType<typeof parseExcelPreview>> | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [columnIndex, setColumnIndex] = useState(0);
  const [firstRowIsHeader, setFirstRowIsHeader] = useState(true);
  const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const selected = controller.batches.find((batch) => batch.id === selectedBatchId) || controller.batches[0];
  const modelOptions = getImageModelOptions().filter((model) =>
    model.isActive !== false && (!selected || controller.getBatchRoutes(selected.mode, model.id, false).length > 0),
  );
  const model = getImageModelById(selected?.settings.modelId);
  const aspectRatios = getHiggsfieldImageOptions(model.id)?.aspectRatios || ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'];
  const routes = selected ? controller.getBatchRoutes(selected.mode, selected.settings.modelId, false) : [];
  const route = routes.find((item) => item.id === selected?.settings.routeId) || routes[0];
  const sizes = selected ? controller.getBatchSizes(selected.settings.modelId, route) : [];
  const inputGroups = selected?.groups || [];
  const taskByGroup = useMemo(() => {
    const groups = new Map<string, BatchGenerationRecord['tasks']>();
    for (const task of selected?.tasks || []) groups.set(task.groupId, [...(groups.get(task.groupId) || []), task]);
    return groups;
  }, [selected?.tasks]);
  const activeTasks = selected?.tasks.filter((task) => !['succeeded', 'failed'].includes(task.status)) || [];
  const failedTasks = selected?.tasks.filter((task) => task.status === 'failed') || [];
  const successful = selected?.tasks.filter((task) => task.status === 'succeeded').length || 0;
  const hasCost = Boolean(route && (typeof route.pointCost === 'number' || Object.values(route.sizeOverrides || {}).some((item) => typeof item.pointCost === 'number')));
  const estimatedCost = selected && route && hasCost
    ? getImageRoutePointCost(route, selected.settings.imageSize) * selected.tasks.length
    : null;
  const editable = selected?.status === 'draft' && !controller.activeBatchId;

  useEffect(() => {
    void Promise.all([ensureImageModelCatalogLoaded(), ensureImageRouteCatalogLoaded()]);
  }, []);

  useEffect(() => {
    if (!selectedBatchId && controller.batches.length) setSelectedBatchId(controller.batches[0].id);
  }, [controller.batches, selectedBatchId]);

  useEffect(() => {
    const assetIds = [...new Set(controller.batches.flatMap((batch) => batch.groups.flatMap((group) => group.referenceAssetIds)))];
    let cancelled = false;
    const missing = assetIds.filter((id) => !previewCache.current[id]);
    void Promise.all(missing.map(async (id) => [id, await assetStorage.getAssetUrl(id)] as const)).then((entries) => {
      if (!cancelled) {
        previewCache.current = { ...previewCache.current, ...Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => !!entry[1])) };
        setReferencePreviews(previewCache.current);
      }
    });
    return () => { cancelled = true; };
  }, [controller.batches]);

  useEffect(() => () => {
    Object.values(previewCache.current).forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const patchGroups = (change: (groups: BatchInputGroup[]) => BatchInputGroup[]) => {
    if (!selected) return;
    void controller.replaceGroups(selected.id, change).catch((reason) => setError(reason.message || '批次更新失败'));
  };

  const patchSettings = (updates: Partial<BatchGenerationSettings>) => {
    if (!selected) return;
    void controller.updateSettings(selected.id, updates).catch((reason) => setError(reason.message || '配置更新失败'));
  };

  const changeModel = (modelId: string) => {
    if (!selected) return;
    const nextRoute = controller.getBatchRoutes(selected.mode, modelId, false)[0];
    const providerOptions = getHiggsfieldImageOptions(modelId);
    patchSettings({
      modelId,
      routeId: nextRoute?.id || '',
      imageSize: controller.getBatchSizes(modelId, nextRoute)[0] || getImageModelSizeOptions(modelId)[0] || '1k',
      ...(providerOptions && !providerOptions.aspectRatios.includes(selected.settings.aspectRatio) ? { aspectRatio: '1:1' } : {}),
    });
  };

  const addBatch = async (mode: BatchMode) => {
    try {
      const id = await controller.createBatch(mode, { ...initialSettings });
      setSelectedBatchId(id);
      setReferenceMode('independent');
      setSharedReferences([]);
      setSharedPrompt('');
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '创建批次失败');
    }
  };

  const importFile = async (file: File) => {
    try {
      if (/\.(xlsx|xls)$/i.test(file.name)) {
        const preview = await parseExcelPreview(file);
        setImportPreview(preview);
        setSheetIndex(0);
        setColumnIndex(0);
        setFirstRowIsHeader(Boolean(preview.sheets[0]?.header.some((value) => /提示词|prompt|description|描述/i.test(value))));
        return;
      }
      const prompts = await parsePromptFile(file);
      patchGroups((groups) => [...groups, ...prompts.map((prompt) => createGroup(prompt, selected?.settings.outputCount || 1))]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '文件解析失败');
    }
  };

  const applyExcel = () => {
    if (!importPreview) return;
    const sheet = importPreview.sheets[sheetIndex];
    const prompts = sheet?.rows.slice(firstRowIsHeader ? 1 : 0).map((row) => row[columnIndex]).filter(Boolean) || [];
    patchGroups((groups) => [...groups, ...prompts.map((prompt) => createGroup(prompt, selected?.settings.outputCount || 1))]);
    setImportPreview(null);
  };

  const addReferenceFiles = async (files: FileList | null) => {
    if (!selected || !files) return;
    const newIds: string[] = [];
    try {
      for (const file of Array.from(files).filter((item) => item.type.startsWith('image/'))) {
        newIds.push(await assetStorage.storeBlob(file));
      }
      if (referenceMode === 'shared') {
        setSharedReferences((current) => [...current, ...newIds]);
      } else {
        patchGroups((groups) => [...groups, ...newIds.map((id) => createGroup(sharedPrompt, selected.settings.outputCount, [id]))]);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '读取参考图失败');
    }
  };

  const applySharedReferences = () => {
    if (!sharedReferences.length || !sharedPrompt.trim()) {
      setError('请添加参考图片并填写共享提示词');
      return;
    }
    patchGroups((groups) => [...groups, createGroup(sharedPrompt.trim(), selected?.settings.outputCount || 1, sharedReferences)]);
    setSharedPrompt('');
    setSharedReferences([]);
    setError('');
  };

  const start = async () => {
    if (!selected) return;
    try {
      await controller.startBatch(selected.id);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '批次启动失败');
    }
  };

  const handleFileInput = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) await importFile(file);
    event.target.value = '';
  };

  return (
    <div className="fixed inset-0 z-[72] flex flex-col bg-[#101112] text-zinc-100" role="dialog" aria-modal="true" aria-label="批量生图工作台">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/10 px-5">
        <div className="flex min-w-0 items-center gap-3">
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-md text-zinc-400 hover:bg-white/10 hover:text-white" aria-label="返回画布"><ArrowLeft size={18} /></button>
          <span className="text-sm font-semibold">批量生图工作台</span>
          <span className="hidden text-xs text-zinc-500 sm:inline">/</span>
          <span className="hidden truncate text-xs text-zinc-400 sm:inline">{selected?.title || '新建批次'}</span>
        </div>
        <div className="flex items-center gap-2">
          {selected?.status === 'running' || controller.activeBatchId === selected?.id
            ? <button onClick={() => void controller.pauseBatch(selected.id)} className="flex h-9 items-center gap-2 rounded-md border border-white/15 px-3 text-sm hover:bg-white/10"><Pause size={15} />暂停</button>
            : <button onClick={() => void start()} disabled={!selected || !selected.tasks.length || !activeTasks.length || controller.loading} className="flex h-9 items-center gap-2 rounded-md bg-emerald-600 px-3 text-sm font-medium text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-40"><Play size={15} />{selected?.status === 'draft' ? '开始生成' : '继续批次'}</button>}
          {failedTasks.length > 0 && <button onClick={() => selected && void controller.retryTasks(selected.id, failedTasks.map((task) => task.id)).catch((reason) => setError(reason.message || '重试失败'))} disabled={!!controller.activeBatchId} className="grid h-9 w-9 place-items-center rounded-md text-zinc-300 hover:bg-white/10 disabled:opacity-40" title="只重试失败项" aria-label="只重试失败项"><RefreshCw size={16} /></button>}
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-md text-zinc-400 hover:bg-white/10 hover:text-white" aria-label="关闭工作台"><X size={18} /></button>
        </div>
      </header>

      {controller.batches.length > 1 && <nav className="flex min-w-0 gap-1 overflow-x-auto border-b border-white/10 px-3 py-2 lg:hidden" aria-label="切换批次">
        {controller.batches.map((batch) => <button key={batch.id} onClick={() => setSelectedBatchId(batch.id)} className={`max-w-48 shrink-0 truncate rounded-md px-3 py-2 text-xs ${selected?.id === batch.id ? 'bg-white/10 text-white' : 'text-zinc-400 hover:bg-white/5'}`}>
          {batch.title}
        </button>)}
      </nav>}

      <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 lg:grid-cols-[230px_minmax(0,1fr)_310px]">
        <aside className="hidden min-h-0 flex-col border-r border-white/10 lg:flex">
          <div className="flex items-center justify-between px-4 py-4"><span className="text-xs font-medium uppercase text-zinc-500">批次</span><button onClick={() => void addBatch('t2i')} className="grid h-8 w-8 place-items-center rounded-md text-zinc-400 hover:bg-white/10 hover:text-white" title="新建批次"><Plus size={17} /></button></div>
          <nav className="min-h-0 flex-1 overflow-y-auto px-2">
            {controller.batches.map((batch) => {
              const done = batch.tasks.filter((task) => ['succeeded', 'failed'].includes(task.status)).length;
              return <button key={batch.id} onClick={() => setSelectedBatchId(batch.id)} className={`mb-1 w-full rounded-md px-3 py-3 text-left ${selected?.id === batch.id ? 'bg-white/10 text-white' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'}`}>
                <span className="block truncate text-sm">{batch.title}</span>
                <span className="mt-1 flex justify-between text-[11px] text-zinc-500"><span>{batch.mode === 't2i' ? '文生图' : '图生图'} · {batch.status === 'draft' ? '草稿' : batch.status === 'running' ? '运行中' : batch.status === 'paused' ? '已暂停' : '已完成'}</span><span>{done}/{batch.tasks.length}</span></span>
              </button>;
            })}
          </nav>
          {selected && <div className="m-3 flex gap-1">
            <button onClick={() => void controller.duplicateBatch(selected.id).then(setSelectedBatchId).catch((reason) => setError(reason.message || '复制批次失败'))} className="flex h-9 flex-1 items-center gap-2 rounded-md px-3 text-xs text-zinc-500 hover:bg-white/5 hover:text-zinc-200"><Copy size={14} />复制批次</button>
            {selected.status !== 'running' && <button onClick={() => { if (window.confirm('删除这个批次记录？')) void controller.deleteBatch(selected.id); }} className="flex h-9 items-center gap-2 rounded-md px-3 text-xs text-zinc-500 hover:bg-rose-500/10 hover:text-rose-300"><Trash2 size={14} />删除</button>}
          </div>}
        </aside>

        <main className="flex min-h-0 min-w-0 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-4 py-3">
            <button onClick={() => void addBatch('t2i')} className="flex h-9 items-center gap-2 rounded-md border border-white/15 px-3 text-xs text-zinc-300 hover:bg-white/5"><Plus size={14} />文生图批次</button>
            <button onClick={() => void addBatch('i2i')} className="flex h-9 items-center gap-2 rounded-md border border-white/15 px-3 text-xs text-zinc-300 hover:bg-white/5"><ImagePlus size={14} />图生图批次</button>
            {selected && <span className="ml-auto text-xs text-zinc-500">{successful} 完成 · {failedTasks.length} 失败 · {activeTasks.length} 待处理</span>}
          </div>
          {!selected ? <div className="grid flex-1 place-items-center text-sm text-zinc-500">{controller.loading ? '正在恢复批次' : '创建批次后开始添加生成任务'}</div> : (
            <>
              <div className="flex flex-wrap items-center gap-2 border-b border-white/10 px-4 py-3">
                {selected.mode === 't2i' ? <><button onClick={() => fileInput.current?.click()} disabled={!editable} className="flex h-9 items-center gap-2 rounded-md bg-white/5 px-3 text-xs text-zinc-300 hover:bg-white/10 disabled:opacity-40"><FileSpreadsheet size={15} />导入提示词</button><button onClick={() => patchGroups((groups) => [...groups, createGroup('', selected.settings.outputCount)])} disabled={!editable} className="flex h-9 items-center gap-2 rounded-md bg-white/5 px-3 text-xs text-zinc-300 hover:bg-white/10 disabled:opacity-40"><Plus size={14} />添加一行</button></> : <>
                  <div className="flex rounded-md border border-white/10 p-0.5">
                    <button onClick={() => setReferenceMode('independent')} className={`h-8 rounded px-3 text-xs ${referenceMode === 'independent' ? 'bg-white/10 text-white' : 'text-zinc-500'}`}>逐图独立</button>
                    <button onClick={() => setReferenceMode('shared')} className={`h-8 rounded px-3 text-xs ${referenceMode === 'shared' ? 'bg-white/10 text-white' : 'text-zinc-500'}`}>多图共同参考</button>
                  </div>
                  <label className={`flex h-9 cursor-pointer items-center gap-2 rounded-md bg-white/5 px-3 text-xs text-zinc-300 hover:bg-white/10 ${editable ? '' : 'pointer-events-none opacity-40'}`}><ImagePlus size={15} />添加参考图<input type="file" multiple accept="image/*" className="hidden" disabled={!editable} onChange={(event) => { void addReferenceFiles(event.target.files); event.target.value = ''; }} /></label>
                  {referenceMode === 'shared' && <><input value={sharedPrompt} onChange={(event) => setSharedPrompt(event.target.value)} disabled={!editable} placeholder="多张图片共同使用的提示词" className="h-9 min-w-40 flex-1 rounded-md border border-white/10 bg-transparent px-3 text-xs outline-none focus:border-emerald-500/70 disabled:opacity-50" /><button onClick={applySharedReferences} disabled={!editable || !sharedReferences.length} className="h-9 rounded-md bg-emerald-600 px-3 text-xs text-white disabled:opacity-40">创建共同参考任务</button></>}
                  {referenceMode === 'shared' && sharedReferences.map((id) => <img key={id} src={referencePreviews[id]} alt="共享参考图" className="h-9 w-9 rounded-sm bg-white/5 object-cover" />)}
                </>}
                <input ref={fileInput} type="file" accept=".xlsx,.xls,.docx,.txt" className="hidden" onChange={(event) => { void handleFileInput(event); }} />
              </div>
              <details className="border-b border-white/10 px-4 py-2 lg:hidden">
                <summary className="cursor-pointer py-1 text-xs text-zinc-400">模型与生成参数</summary>
                <div className="grid grid-cols-2 gap-2 py-3">
                  <select aria-label="生成模型" value={selected.settings.modelId} disabled={!editable} onChange={(event) => changeModel(event.target.value)} className="h-9 min-w-0 rounded-md border border-white/10 bg-[#18191b] px-2 text-xs">
                    {modelOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select>
                  <select aria-label="生成线路" value={selected.settings.routeId} disabled={!editable} onChange={(event) => void controller.updateSettings(selected.id, { routeId: event.target.value })} className="h-9 min-w-0 rounded-md border border-white/10 bg-[#18191b] px-2 text-xs">
                    {routes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                  </select>
                  <select aria-label="画幅" value={selected.settings.aspectRatio} disabled={!editable} onChange={(event) => patchSettings({ aspectRatio: event.target.value })} className="h-9 rounded-md border border-white/10 bg-[#18191b] px-2 text-xs">{aspectRatios.map((value) => <option key={value}>{value}</option>)}</select>
                  <select aria-label="输出尺寸" value={selected.settings.imageSize} disabled={!editable} onChange={(event) => patchSettings({ imageSize: event.target.value })} className="h-9 rounded-md border border-white/10 bg-[#18191b] px-2 text-xs">{(sizes.length ? sizes : [selected.settings.imageSize]).map((value) => <option key={value}>{value}</option>)}</select>
                  <select aria-label="并发任务数" value={selected.settings.concurrency} disabled={!editable} onChange={(event) => patchSettings({ concurrency: Number(event.target.value) as 1 | 3 | 6 })} className="h-9 rounded-md border border-white/10 bg-[#18191b] px-2 text-xs">{[1, 3, 6].map((value) => <option key={value} value={value}>并发 {value}</option>)}</select>
                  <select aria-label="每项默认张数" value={selected.settings.outputCount} disabled={!editable} onChange={(event) => patchSettings({ outputCount: Number(event.target.value) })} className="h-9 rounded-md border border-white/10 bg-[#18191b] px-2 text-xs">{Array.from({ length: MAX_BATCH_OUTPUT_COUNT }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1} 张 / 项</option>)}</select>
                  <label className="flex h-9 items-center gap-2 text-xs text-zinc-300"><input type="checkbox" checked={selected.settings.autoDownload} disabled={!editable} onChange={(event) => patchSettings({ autoDownload: event.target.checked })} className="h-4 w-4 accent-emerald-500" />成功后自动下载</label>
                </div>
              </details>
              <div className="min-h-0 min-w-0 flex-1 overflow-auto">
                <div className="min-w-0 md:min-w-[700px]">
                  <div className="hidden grid-cols-[54px_minmax(230px,1fr)_115px_110px_100px] border-b border-white/10 px-4 py-2 text-[11px] font-medium text-zinc-500 md:grid"><span>参与</span><span>{selected.mode === 't2i' ? '提示词 / 参考图' : '任务输入'}</span><span>输出张数</span><span>任务状态</span><span>操作</span></div>
                  {inputGroups.map((group, index) => {
                    const tasks = taskByGroup.get(group.id) || [];
                    const finished = tasks.length > 0 && tasks.every((task) => ['succeeded', 'failed'].includes(task.status));
                    const summary: BatchTaskStatus = tasks.some((task) => task.status === 'running' || task.status === 'submitting') ? 'running' : tasks.some((task) => task.status === 'failed') ? 'failed' : tasks.some((task) => task.status === 'succeeded') && finished ? 'succeeded' : tasks[0]?.status || 'pending';
                    return <div key={group.id} className="grid min-h-24 grid-cols-[36px_minmax(0,1fr)_80px] items-start border-b border-white/5 px-3 py-3 md:grid-cols-[54px_minmax(230px,1fr)_115px_110px_100px] md:px-4">
                      <label className="flex h-10 items-center"><input type="checkbox" checked={group.enabled} disabled={!editable} onChange={(event) => patchGroups((groups) => groups.map((item) => item.id === group.id ? { ...item, enabled: event.target.checked } : item))} className="h-4 w-4 accent-emerald-500" /></label>
                      <div className="flex min-w-0 gap-3">
                        {group.referenceAssetIds.length > 0 && <div className="flex shrink-0 gap-1">{group.referenceAssetIds.map((id) => <img key={id} src={referencePreviews[id]} className="h-12 w-12 rounded-sm bg-white/5 object-cover" />)}</div>}
                        <textarea value={group.prompt} disabled={!editable} onChange={(event) => patchGroups((groups) => groups.map((item) => item.id === group.id ? { ...item, prompt: event.target.value } : item))} placeholder="输入描述词" rows={2} className="min-h-12 w-full resize-y rounded-md border border-white/10 bg-transparent px-2 py-2 text-xs leading-5 outline-none focus:border-emerald-500/70 disabled:border-transparent disabled:text-zinc-400" />
                      </div>
                      <select value={group.outputCount} disabled={!editable} onChange={(event) => patchGroups((groups) => groups.map((item) => item.id === group.id ? { ...item, outputCount: Number(event.target.value) } : item))} className="mx-2 mt-1 h-9 rounded-md border border-white/10 bg-[#18191b] px-2 text-xs outline-none disabled:opacity-50">{Array.from({ length: MAX_BATCH_OUTPUT_COUNT }, (_, output) => <option key={output + 1} value={output + 1}>{output + 1} 张</option>)}</select>
                      <div className={`col-start-2 mt-3 text-xs md:col-auto ${statusColor(summary)}`}>{STATUS_LABEL[summary]}{tasks.length > 1 && <span className="ml-1 text-zinc-600">{tasks.filter((task) => task.status === 'succeeded').length}/{tasks.length}</span>}</div>
                      <div className="col-start-3 row-start-2 mt-1 flex items-center gap-1 md:col-auto md:row-auto">
                        {tasks.find((task) => task.nodeId)?.nodeId && <button onClick={() => onLocateNode(tasks.find((task) => task.nodeId)!.nodeId!)} title="定位画布结果" className="grid h-8 w-8 place-items-center rounded text-zinc-500 hover:bg-white/10 hover:text-white"><MapPin size={15} /></button>}
                        <button onClick={() => patchGroups((groups) => groups.filter((item) => item.id !== group.id))} disabled={!editable} title="移除任务" className="grid h-8 w-8 place-items-center rounded text-zinc-600 hover:bg-rose-500/10 hover:text-rose-300 disabled:opacity-30"><Trash2 size={14} /></button>
                      </div>
                      {tasks.map((task, taskIndex) => <div key={task.id} className="col-start-2 mt-2 flex min-w-0 items-center gap-2 text-[11px]">
                        <span className={statusColor(task.status)}>{taskIndex + 1}. {STATUS_LABEL[task.status]}</span>
                        {task.progress !== undefined && !['succeeded', 'failed'].includes(task.status) && <span className="text-zinc-600">{Math.round(task.progress)}%</span>}
                        {task.resultUrl && <><a href={task.resultUrl} target="_blank" rel="noreferrer" className="flex min-w-0 items-center gap-1 text-emerald-300 hover:text-emerald-200"><Check size={12} />预览</a>{onDownloadResult && <button onClick={() => onDownloadResult(task.resultUrl!, task.prompt, task.nodeId || task.id)} className="flex items-center gap-1 text-zinc-400 hover:text-white"><Download size={12} />下载</button>}</>}
                        {task.nodeId && <button onClick={() => onLocateNode(task.nodeId!)} className="text-zinc-500 hover:text-zinc-200" title="定位这个结果"><MapPin size={12} /></button>}
                        {task.status === 'failed' && selected && <button onClick={() => void controller.retryTasks(selected.id, [task.id]).catch((reason) => setError(reason.message || '重试失败'))} disabled={!!controller.activeBatchId} className="text-amber-300 hover:text-amber-200 disabled:opacity-40">重试</button>}
                        {task.error && <span className="min-w-0 truncate text-rose-300" title={task.error}>{task.error}</span>}
                      </div>)}
                    </div>;
                  })}
                </div>
                {inputGroups.length === 0 && <div className="grid min-h-48 place-items-center px-6 text-center text-sm text-zinc-500">{selected.mode === 't2i' ? '导入提示词文件，或添加一行开始编辑' : referenceMode === 'shared' ? '添加多张参考图并创建共同参考任务' : '添加参考图后，每张图片会生成独立任务'}</div>}
              </div>
            </>
          )}
          {error && <div className="flex items-center justify-between border-t border-rose-500/20 bg-rose-500/5 px-4 py-2 text-xs text-rose-300"><span>{error}</span><button onClick={() => setError('')} aria-label="关闭错误提示"><X size={14} /></button></div>}
          <footer className="flex min-h-11 items-center gap-2 border-t border-white/10 px-4 text-[11px] text-zinc-500"><span>{selected?.tasks.length || 0} 个任务</span><span>·</span><span>{successful} 张完成</span><span className="ml-auto text-zinc-400 lg:hidden">预计 {estimatedCost === null ? '暂不可估算' : `${estimatedCost} 积分`}</span>{controller.activeBatchId && <span className="flex items-center gap-1 text-cyan-300"><LoaderCircle size={13} className="animate-spin" />批次仍在运行</span>}</footer>
        </main>

        <aside className="hidden min-h-0 flex-col border-l border-white/10 lg:flex">
          {selected ? <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <label className="mb-5 block"><span className="mb-2 block text-[11px] font-medium text-zinc-500">批次名称</span><input value={selected.title} disabled={!editable} onChange={(event) => void controller.updateSettings(selected.id, {}, event.target.value)} className="h-9 w-full rounded-md border border-white/10 bg-transparent px-3 text-sm outline-none focus:border-emerald-500/70 disabled:border-transparent" /></label>
            <label className="mb-5 block"><span className="mb-2 block text-[11px] font-medium text-zinc-500">生成模型</span><select value={selected.settings.modelId} disabled={!editable} onChange={(event) => changeModel(event.target.value)} className="h-10 w-full rounded-md border border-white/10 bg-[#18191b] px-3 text-sm outline-none focus:border-emerald-500/70 disabled:opacity-50">{modelOptions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <label className="mb-5 block"><span className="mb-2 block text-[11px] font-medium text-zinc-500">线路</span><select value={selected.settings.routeId} disabled={!editable} onChange={(event) => void controller.updateSettings(selected.id, { routeId: event.target.value, imageSize: controller.getBatchSizes(selected.settings.modelId, routes.find((item) => item.id === event.target.value))[0] || selected.settings.imageSize })} className="h-10 w-full rounded-md border border-white/10 bg-[#18191b] px-3 text-sm outline-none focus:border-emerald-500/70 disabled:opacity-50">{routes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
            <div className="mb-5 grid grid-cols-2 gap-3">
              <label><span className="mb-2 block text-[11px] font-medium text-zinc-500">画幅</span><select value={selected.settings.aspectRatio} disabled={!editable} onChange={(event) => patchSettings({ aspectRatio: event.target.value })} className="h-9 w-full rounded-md border border-white/10 bg-[#18191b] px-2 text-xs">{aspectRatios.map((value) => <option key={value}>{value}</option>)}</select></label>
              <label><span className="mb-2 block text-[11px] font-medium text-zinc-500">输出尺寸</span><select value={selected.settings.imageSize} disabled={!editable} onChange={(event) => patchSettings({ imageSize: event.target.value })} className="h-9 w-full rounded-md border border-white/10 bg-[#18191b] px-2 text-xs">{(sizes.length ? sizes : [selected.settings.imageSize]).map((value) => <option key={value}>{value}</option>)}</select></label>
              <label><span className="mb-2 block text-[11px] font-medium text-zinc-500">每项默认张数</span><select value={selected.settings.outputCount} disabled={!editable} onChange={(event) => patchSettings({ outputCount: Number(event.target.value) })} className="h-9 w-full rounded-md border border-white/10 bg-[#18191b] px-2 text-xs">{Array.from({ length: MAX_BATCH_OUTPUT_COUNT }, (_, index) => <option key={index + 1}>{index + 1}</option>)}</select></label>
            </div>
            <label className="mb-5 block"><span className="mb-2 block text-[11px] font-medium text-zinc-500">并发任务数</span><div className="flex rounded-md border border-white/10 p-1">{([1, 3, 6] as const).map((value) => <button key={value} onClick={() => patchSettings({ concurrency: value })} disabled={!editable} className={`h-8 flex-1 rounded text-xs ${selected.settings.concurrency === value ? 'bg-white/10 text-white' : 'text-zinc-500'} disabled:opacity-50`}>{value}</button>)}</div></label>
            <label className="mb-5 flex items-center gap-3 text-xs text-zinc-300"><input type="checkbox" checked={selected.settings.autoDownload} disabled={!editable} onChange={(event) => patchSettings({ autoDownload: event.target.checked })} className="h-4 w-4 accent-emerald-500" />成功后自动下载</label>
            <div className="border-t border-white/10 pt-4"><div className="flex justify-between text-xs text-zinc-400"><span>预计消耗</span><span className="font-medium text-zinc-200">{estimatedCost === null ? '暂不可估算' : `${estimatedCost} 积分`}</span></div><div className="mt-2 text-[11px] text-zinc-600">{selected.tasks.length} 个输出任务 · {model?.label || selected.settings.modelId}</div></div>
          </div> : null}
        </aside>
      </div>

      {importPreview && <div className="fixed inset-0 z-[75] grid place-items-center bg-black/65 p-4"><div className="w-full max-w-2xl rounded-md border border-white/10 bg-[#171819] shadow-2xl"><div className="flex h-12 items-center justify-between border-b border-white/10 px-4 text-sm font-medium"><span>Excel 导入预览</span><button onClick={() => setImportPreview(null)} aria-label="关闭导入预览" className="text-zinc-500 hover:text-white"><X size={17} /></button></div><div className="grid grid-cols-2 gap-3 p-4"><label className="text-xs text-zinc-400">工作表<select value={sheetIndex} onChange={(event) => { setSheetIndex(Number(event.target.value)); setColumnIndex(0); }} className="mt-2 h-9 w-full rounded-md border border-white/10 bg-[#101112] px-2 text-white">{importPreview.sheets.map((sheet, index) => <option key={sheet.name} value={index}>{sheet.name}</option>)}</select></label><label className="text-xs text-zinc-400">提示词列<select value={columnIndex} onChange={(event) => setColumnIndex(Number(event.target.value))} className="mt-2 h-9 w-full rounded-md border border-white/10 bg-[#101112] px-2 text-white">{(importPreview.sheets[sheetIndex]?.columns || []).map((column, index) => <option key={index} value={index}>{column}</option>)}</select></label></div><label className="flex items-center gap-2 px-4 pb-3 text-xs text-zinc-400"><input type="checkbox" checked={firstRowIsHeader} onChange={(event) => setFirstRowIsHeader(event.target.checked)} className="h-4 w-4 accent-emerald-500" />首行是表头</label><div className="max-h-64 overflow-auto border-y border-white/10 px-4 py-2">{(importPreview.sheets[sheetIndex]?.rows || []).slice(firstRowIsHeader ? 1 : 0, (firstRowIsHeader ? 1 : 0) + 8).map((row, index) => <div key={index} className="border-b border-white/5 py-2 text-xs text-zinc-300">{row[columnIndex] || <span className="text-zinc-600">（空行）</span>}</div>)}</div><div className="flex items-center justify-between px-4 py-3"><span className="text-xs text-zinc-500">{(importPreview.sheets[sheetIndex]?.rows || []).slice(firstRowIsHeader ? 1 : 0).filter((row) => row[columnIndex]).length} 条提示词</span><button onClick={applyExcel} className="h-9 rounded-md bg-emerald-600 px-4 text-xs font-medium text-white hover:bg-emerald-500">导入预览内容</button></div></div></div>}
    </div>
  );
};
