import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Loader2,
  Network,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { AuthSessionPayload } from '../src/services/accountIdentity';
import {
  AdminImageRoute,
  AdminImageRouteCatalogResponse,
  createAdminImageRoute,
  deleteAdminImageRoute,
  fetchAdminImageRoutes,
  updateAdminImageRoute,
  type AdminImageRoutePayload,
} from '../src/services/imageRouteAdminService';
import {
  AdminImageModel,
  fetchAdminImageModels,
} from '../src/services/imageModelAdminService';
import { useToast } from '../src/context/ToastContext';
import { formatPoint, roundNonNegativePoint } from '../src/utils/pointFormat';

interface RouteAdminPanelProps {
  session: AuthSessionPayload | null;
}

const createEmptyForm = (sortOrder = 0): AdminImageRoutePayload => ({
  id: '',
  label: '',
  description: '',
  modelFamily: 'default',
  line: `route-${sortOrder + 1}`,
  transport: 'openai-image',
  mode: 'async',
  baseUrl: '',
  generatePath: '/v1/images/generations?async=true',
  taskPath: '/v1/images/tasks/{taskId}',
  editPath: '/v1/images/edits?async=true',
  chatPath: '',
  upstreamModel: '',
  useRequestModel: false,
  apiKeyEnv: '',
  apiKey: '',
  pointCost: 10,
  sortOrder,
  isActive: true,
  isDefaultRoute: false,
  isDefaultNanoBananaLine: false,
});

const mapRouteToForm = (route: AdminImageRoute): AdminImageRoutePayload => ({
  id: route.id,
  label: route.label,
  description: route.description || '',
  modelFamily: route.modelFamily,
  line: route.line,
  transport: route.transport,
  mode: route.mode,
  baseUrl: route.baseUrl,
  generatePath: route.generatePath,
  taskPath: route.taskPath || '',
  editPath: route.editPath || '',
  chatPath: route.chatPath || '',
  upstreamModel: route.upstreamModel || '',
  useRequestModel: route.useRequestModel === true,
  apiKeyEnv: route.apiKeyEnv || '',
  apiKey: '',
  pointCost: route.pointCost || 0,
  sortOrder: route.sortOrder || 0,
  isActive: route.isActive !== false,
  isDefaultRoute: route.isDefaultRoute === true,
  isDefaultNanoBananaLine: route.isDefaultNanoBananaLine === true,
});

const RouteAdminPanel: React.FC<RouteAdminPanelProps> = ({ session }) => {
  const toast = useToast();
  const [catalog, setCatalog] = useState<AdminImageRouteCatalogResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingRouteId, setEditingRouteId] = useState<string | null>(null);
  const [form, setForm] = useState<AdminImageRoutePayload>(createEmptyForm(0));
  const [models, setModels] = useState<AdminImageModel[]>([]);

  const isAdmin = session?.user?.isAdmin === true;

  const sortedRoutes = useMemo(
    () =>
      [...(catalog?.routes || [])].sort((left, right) => {
        if ((left.sortOrder || 0) !== (right.sortOrder || 0)) {
          return (left.sortOrder || 0) - (right.sortOrder || 0);
        }
        return left.label.localeCompare(right.label);
      }),
    [catalog],
  );

  const modelsByRouteFamily = useMemo(() => {
    const map = new Map<string, AdminImageModel[]>();
    for (const model of models) {
      const family = String(model.routeFamily || '').trim();
      if (!family) continue;
      const existing = map.get(family) || [];
      existing.push(model);
      map.set(family, existing);
    }
    return map;
  }, [models]);

  const boundModelsForCurrentFamily = useMemo(
    () => modelsByRouteFamily.get(String(form.modelFamily || '').trim()) || [],
    [form.modelFamily, modelsByRouteFamily],
  );

  const resetCreateForm = useCallback(() => {
    setEditingRouteId(null);
    setForm(createEmptyForm(sortedRoutes.length));
  }, [sortedRoutes.length]);

  const loadRoutes = useCallback(async () => {
    if (!isAdmin) {
      setCatalog(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const [next, nextModels] = await Promise.all([
        fetchAdminImageRoutes(),
        fetchAdminImageModels(),
      ]);
      setCatalog(next);
      setModels(nextModels.models || []);
      setForm((prev) =>
        editingRouteId
          ? prev
          : createEmptyForm(
              [...(next.routes || [])].sort(
                (left, right) => (left.sortOrder || 0) - (right.sortOrder || 0),
              ).length,
            ),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [editingRouteId, isAdmin]);

  useEffect(() => {
    void loadRoutes();
  }, [loadRoutes]);

  const handleEdit = (route: AdminImageRoute) => {
    setEditingRouteId(route.id);
    setForm(mapRouteToForm(route));
  };

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);

    try {
      const payload: AdminImageRoutePayload = {
        ...form,
        id: form.id.trim(),
        label: form.label.trim(),
        description: form.description?.trim() || '',
        modelFamily: form.modelFamily.trim(),
        line: form.line.trim(),
        baseUrl: form.baseUrl.trim(),
        generatePath: form.generatePath.trim(),
        taskPath: form.taskPath?.trim() || '',
        editPath: form.editPath?.trim() || '',
        chatPath: form.chatPath?.trim() || '',
        upstreamModel: form.upstreamModel?.trim() || '',
        apiKeyEnv: form.apiKeyEnv?.trim() || '',
        apiKey: form.apiKey?.trim() || '',
        pointCost: roundNonNegativePoint(form.pointCost || 0, 0),
        sortOrder: Number(form.sortOrder || 0),
      };

      let next: AdminImageRouteCatalogResponse;
      if (editingRouteId) {
        const updatePayload = { ...payload };
        if (!updatePayload.apiKey) {
          delete updatePayload.apiKey;
        }
        next = await updateAdminImageRoute(editingRouteId, updatePayload);
        toast.success(`已更新线路 ${editingRouteId}`);
      } else {
        next = await createAdminImageRoute(payload);
        toast.success(`已创建线路 ${payload.id}`);
      }

      setCatalog(next);
      setEditingRouteId(null);
      setForm(createEmptyForm(next.routes.length));
    } catch (err) {
      const message = (err as Error).message;
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editingRouteId) return;
    if (!window.confirm(`确定删除线路 ${editingRouteId} 吗？删除后这条线路将立即不可用。`)) {
      return;
    }

    setDeleting(true);
    setError(null);
    try {
      const next = await deleteAdminImageRoute(editingRouteId);
      setCatalog(next);
      setEditingRouteId(null);
      setForm(createEmptyForm(next.routes.length));
      toast.success(`已删除线路 ${editingRouteId}`);
    } catch (err) {
      const message = (err as Error).message;
      setError(message);
      toast.error(message);
    } finally {
      setDeleting(false);
    }
  };

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="space-y-4 rounded-2xl border border-violet-500/20 bg-violet-500/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-violet-100">
            <Network size={16} />
            线路与模型管理
          </div>
          <p className="mt-1 text-xs text-violet-100/70">
            管理员可在这里新增、修改图片线路、上游模型、价格、默认线路和密钥配置。
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadRoutes()}
          disabled={loading}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-xs text-gray-200 hover:bg-white/10 disabled:opacity-50"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          刷新
        </button>
      </div>

      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {error}
        </div>
      )}

      <div className="rounded-2xl border border-violet-400/15 bg-black/20 p-4 text-sm text-gray-300">
        <div className="font-medium text-violet-100">模型和线路的关系</div>
        <div className="mt-2 space-y-2 text-xs leading-6 text-gray-400">
          <p>1. 模型管理里的 <span className="text-violet-200">routeFamily</span>，决定这个模型会使用哪一组线路。</p>
          <p>2. 线路管理里的 <span className="text-violet-200">线路族</span>，必须和模型的 routeFamily 一致，模型才会走到这条线路。</p>
          <p>3. 如果某个模型需要独立的接口地址或同步/异步方式，最简单的做法就是给它一个独立 routeFamily，再为这组 family 新建专用线路。</p>
          <p>4. 如果多种模型共用同一套接口，只是上游模型名不同，可以让线路勾选“使用请求里的模型名”，再把具体模型名填到模型管理里的 requestModel。</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-3">
          <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
            <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-gray-400">
              <ShieldCheck size={13} />
              已配置线路
            </div>
            <div className="space-y-2">
              {sortedRoutes.length === 0 ? (
                <div className="rounded-lg border border-white/5 bg-white/[0.03] px-3 py-4 text-xs text-gray-400">
                  暂无线路数据
                </div>
              ) : (
                sortedRoutes.map((route) => (
                  <button
                    key={route.id}
                    type="button"
                    onClick={() => handleEdit(route)}
                    className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                      editingRouteId === route.id
                        ? 'border-violet-400/40 bg-violet-500/10'
                        : 'border-white/5 bg-white/[0.03] hover:bg-white/[0.06]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-gray-100">
                          {route.label}
                        </div>
                        <div className="mt-1 truncate text-[11px] text-gray-500">
                          {route.modelFamily} / {route.line} / {route.transport} / {route.mode}
                        </div>
                        <div className="mt-1 truncate text-[11px] text-gray-400">
                          模型：{route.upstreamModel || 'useRequestModel'}
                        </div>
                        <div className="mt-1 text-[11px] text-gray-500">
                          关联模型：
                          {' '}
                          {(modelsByRouteFamily.get(route.modelFamily) || [])
                            .map((model) => model.label)
                            .join('、') || '暂无'}
                        </div>
                      </div>
                      <div className="shrink-0 text-right text-[11px] text-gray-300">
                        <div>{formatPoint(route.pointCost || 0)} 点/次</div>
                        <div className="mt-1 flex flex-wrap items-center justify-end gap-1">
                          {route.isActive ? (
                            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300">
                              启用
                            </span>
                          ) : (
                            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-gray-400">
                              停用
                            </span>
                          )}
                          {route.isDefaultRoute && (
                            <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] text-blue-300">
                              默认
                            </span>
                          )}
                          {route.isDefaultNanoBananaLine && (
                            <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300">
                              Nano 默认
                            </span>
                          )}
                          <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-gray-300">
                            {route.hasApiKey ? '已配 Key' : '未配 Key'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-gray-400">
              <SlidersHorizontal size={13} />
              {editingRouteId ? `编辑 ${editingRouteId}` : '新建线路'}
            </div>
            <button
              type="button"
              onClick={resetCreateForm}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 text-[11px] text-gray-200 hover:bg-white/10"
            >
              <Plus size={12} />
              新建
            </button>
          </div>

          <div className="space-y-3">
            <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-xs leading-6 text-gray-300">
              <div>
                当前线路族：
                <span className="ml-1 font-medium text-violet-200">
                  {form.modelFamily || '未填写'}
                </span>
              </div>
              <div>
                已关联模型：
                <span className="ml-1 text-gray-400">
                  {boundModelsForCurrentFamily.map((model) => model.label).join('、') || '暂无模型使用这个线路族'}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <input
                value={form.id}
                onChange={(event) => setForm((prev) => ({ ...prev, id: event.target.value }))}
                placeholder="route id，例如 custom-gemini-route-1"
                disabled={Boolean(editingRouteId)}
                className="h-10 rounded-lg border border-white/10 bg-black/25 px-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none disabled:opacity-60"
              />
              <input
                value={form.label}
                onChange={(event) => setForm((prev) => ({ ...prev, label: event.target.value }))}
                placeholder="显示名称，例如 Line 4"
                className="h-10 rounded-lg border border-white/10 bg-black/25 px-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
              />
            </div>

            <input
              value={form.description || ''}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, description: event.target.value }))
              }
              placeholder="线路描述"
              className="h-10 w-full rounded-lg border border-white/10 bg-black/25 px-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
            />

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <input
                value={form.modelFamily}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, modelFamily: event.target.value }))
                }
                placeholder="线路族，必须等于模型的 routeFamily"
                className="h-10 rounded-lg border border-white/10 bg-black/25 px-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
              />
              <input
                value={form.line}
                onChange={(event) => setForm((prev) => ({ ...prev, line: event.target.value }))}
                placeholder="线路标识，例如 primary / backup / route-2"
                className="h-10 rounded-lg border border-white/10 bg-black/25 px-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
              />
              <input
                value={String(form.sortOrder || 0)}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, sortOrder: Number(event.target.value || 0) }))
                }
                placeholder="排序"
                className="h-10 rounded-lg border border-white/10 bg-black/25 px-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <select
                value={form.transport}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    transport: event.target.value as AdminImageRoutePayload['transport'],
                  }))
                }
                className="h-10 rounded-lg border border-white/10 bg-black/25 px-3 text-sm text-white focus:border-white/20 focus:outline-none"
              >
                <option value="openai-image">openai-image</option>
                <option value="gemini-native">gemini-native</option>
              </select>
              <select
                value={form.mode}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    mode: event.target.value as AdminImageRoutePayload['mode'],
                  }))
                }
                className="h-10 rounded-lg border border-white/10 bg-black/25 px-3 text-sm text-white focus:border-white/20 focus:outline-none"
              >
                <option value="async">async</option>
                <option value="sync">sync</option>
              </select>
            </div>

            <input
              value={form.baseUrl}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, baseUrl: event.target.value }))
              }
              placeholder="Base URL，例如 https://api.example.com"
              className="h-10 w-full rounded-lg border border-white/10 bg-black/25 px-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
            />

            <div className="grid grid-cols-1 gap-3">
              <input
                value={form.generatePath}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, generatePath: event.target.value }))
                }
                placeholder="Generate Path"
                className="h-10 rounded-lg border border-white/10 bg-black/25 px-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
              />
              <input
                value={form.taskPath || ''}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, taskPath: event.target.value }))
                }
                placeholder="Task Path（异步线路可填）"
                className="h-10 rounded-lg border border-white/10 bg-black/25 px-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
              />
              <input
                value={form.editPath || ''}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, editPath: event.target.value }))
                }
                placeholder="Edit Path（可选）"
                className="h-10 rounded-lg border border-white/10 bg-black/25 px-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
              />
              <input
                value={form.chatPath || ''}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, chatPath: event.target.value }))
                }
                placeholder="Chat Path（旧同步线路可选）"
                className="h-10 rounded-lg border border-white/10 bg-black/25 px-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
              />
              <input
                value={form.upstreamModel || ''}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, upstreamModel: event.target.value }))
                }
                placeholder="上游模型名；若勾选 useRequestModel，可留空"
                className="h-10 rounded-lg border border-white/10 bg-black/25 px-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <input
                type="number"
                step="0.1"
                min="0"
                value={String(form.pointCost || 0)}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    pointCost: roundNonNegativePoint(event.target.value || 0, 0),
                  }))
                }
                placeholder="点数价格"
                className="h-10 rounded-lg border border-white/10 bg-black/25 px-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
              />
              <input
                value={form.apiKeyEnv || ''}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, apiKeyEnv: event.target.value }))
                }
                placeholder="环境变量名（可选）"
                className="h-10 rounded-lg border border-white/10 bg-black/25 px-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
              />
              <input
                value={form.apiKey || ''}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, apiKey: event.target.value }))
                }
                placeholder={editingRouteId ? '留空表示不修改 Key' : '直接填写线路 Key'}
                className="h-10 rounded-lg border border-white/10 bg-black/25 px-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-200">
                <input
                  type="checkbox"
                  checked={form.useRequestModel === true}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      useRequestModel: event.target.checked,
                    }))
                  }
                />
                使用请求里的模型名
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-200">
                <input
                  type="checkbox"
                  checked={form.isActive !== false}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, isActive: event.target.checked }))
                  }
                />
                启用此线路
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-200">
                <input
                  type="checkbox"
                  checked={form.isDefaultRoute === true}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      isDefaultRoute: event.target.checked,
                    }))
                  }
                />
                设为全局默认线路
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-200">
                <input
                  type="checkbox"
                  checked={form.isDefaultNanoBananaLine === true}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      isDefaultNanoBananaLine: event.target.checked,
                    }))
                  }
                />
                设为 Nano Banana 默认线
              </label>
            </div>

            <div className="flex flex-wrap gap-3">
              {editingRouteId && (
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={deleting || saving}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 text-sm font-medium text-red-200 transition-colors hover:bg-red-500/20 disabled:opacity-60"
                >
                  {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  删除线路
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={saving || deleting}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-violet-600 px-4 text-sm font-medium text-white transition-colors hover:bg-violet-500 disabled:opacity-60"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {editingRouteId ? '保存修改' : '创建线路'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RouteAdminPanel;
