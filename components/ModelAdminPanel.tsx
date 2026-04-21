import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Boxes,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
} from 'lucide-react';
import { AuthSessionPayload } from '../src/services/accountIdentity';
import {
  AdminImageModel,
  AdminImageModelCatalogResponse,
  createAdminImageModel,
  deleteAdminImageModel,
  fetchAdminImageModels,
  updateAdminImageModel,
  type AdminImageModelPayload,
} from '../src/services/imageModelAdminService';
import { useToast } from '../src/context/ToastContext';
import { formatPoint, roundNonNegativePoint } from '../src/utils/pointFormat';

interface ModelAdminPanelProps {
  session: AuthSessionPayload | null;
}

const arrayToInput = (value?: string[]) => (Array.isArray(value) ? value.join(', ') : '');
const inputToArray = (value?: string) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

type ModelFormState = AdminImageModelPayload & {
  sizeOptionsInput: string;
  extraAspectRatiosInput: string;
};

const createEmptyForm = (sortOrder = 0): ModelFormState => ({
  id: '',
  label: '',
  description: '',
  modelFamily: 'custom',
  routeFamily: 'default',
  requestModel: '',
  selectorCost: 0,
  iconKind: 'banana',
  panelLayout: 'default',
  sizeBehavior: 'passthrough',
  defaultSize: '1k',
  sizeOptions: ['1k', '2k', '4k'],
  sizeOptionsInput: '1k, 2k, 4k',
  extraAspectRatios: [],
  extraAspectRatiosInput: '',
  showSizeSelector: true,
  supportsCustomRatio: true,
  isActive: true,
  isDefaultModel: false,
  sortOrder,
});

const mapModelToForm = (model: AdminImageModel): ModelFormState => ({
  id: model.id,
  label: model.label,
  description: model.description || '',
  modelFamily: model.modelFamily,
  routeFamily: model.routeFamily,
  requestModel: model.requestModel || '',
  selectorCost: model.selectorCost || 0,
  iconKind: model.iconKind || 'banana',
  panelLayout: model.panelLayout || 'default',
  sizeBehavior: model.sizeBehavior || 'passthrough',
  defaultSize: model.defaultSize || '1k',
  sizeOptions: model.sizeOptions || [],
  sizeOptionsInput: arrayToInput(model.sizeOptions),
  extraAspectRatios: model.extraAspectRatios || [],
  extraAspectRatiosInput: arrayToInput(model.extraAspectRatios),
  showSizeSelector: model.showSizeSelector !== false,
  supportsCustomRatio: model.supportsCustomRatio !== false,
  isActive: model.isActive !== false,
  isDefaultModel: model.isDefaultModel === true,
  sortOrder: model.sortOrder || 0,
});

const ModelAdminPanel: React.FC<ModelAdminPanelProps> = ({ session }) => {
  const toast = useToast();
  const [catalog, setCatalog] = useState<AdminImageModelCatalogResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [form, setForm] = useState<ModelFormState>(createEmptyForm(0));

  const isAdmin = session?.user?.isAdmin === true;

  const sortedModels = useMemo(
    () =>
      [...(catalog?.models || [])].sort((left, right) => {
        if ((left.sortOrder || 0) !== (right.sortOrder || 0)) {
          return (left.sortOrder || 0) - (right.sortOrder || 0);
        }
        return left.label.localeCompare(right.label);
      }),
    [catalog],
  );

  const resetCreateForm = useCallback(() => {
    setEditingModelId(null);
    setForm(createEmptyForm(sortedModels.length));
  }, [sortedModels.length]);

  const loadModels = useCallback(async () => {
    if (!isAdmin) {
      setCatalog(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const next = await fetchAdminImageModels();
      setCatalog(next);
      setForm((prev) =>
        editingModelId ? prev : createEmptyForm(next.models.length),
      );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [editingModelId, isAdmin]);

  useEffect(() => {
    void loadModels();
  }, [loadModels]);

  const handleEdit = (model: AdminImageModel) => {
    setEditingModelId(model.id);
    setForm(mapModelToForm(model));
  };

  const handleSubmit = async () => {
    setSaving(true);
    setError(null);

    try {
      const payload: AdminImageModelPayload = {
        ...form,
        id: form.id.trim(),
        label: form.label.trim(),
        description: form.description?.trim() || '',
        modelFamily: form.modelFamily.trim(),
        routeFamily: form.routeFamily.trim(),
        requestModel: form.requestModel?.trim() || '',
        defaultSize: form.defaultSize?.trim().toLowerCase() || '1k',
        selectorCost: roundNonNegativePoint(form.selectorCost || 0, 0),
        sortOrder: Number(form.sortOrder || 0),
        sizeOptions: inputToArray(form.sizeOptionsInput).map((item) => item.toLowerCase()),
        extraAspectRatios: inputToArray(form.extraAspectRatiosInput),
      };

      let next: AdminImageModelCatalogResponse;
      if (editingModelId) {
        next = await updateAdminImageModel(editingModelId, payload);
        toast.success(`已更新模型 ${editingModelId}`);
      } else {
        next = await createAdminImageModel(payload);
        toast.success(`已创建模型 ${payload.id}`);
      }

      setCatalog(next);
      setEditingModelId(null);
      setForm(createEmptyForm(next.models.length));
    } catch (err) {
      const message = (err as Error).message;
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!editingModelId) return;
    if (!window.confirm(`确定删除模型 ${editingModelId} 吗？删除后前台将不再显示它。`)) {
      return;
    }

    setDeleting(true);
    setError(null);
    try {
      const next = await deleteAdminImageModel(editingModelId);
      setCatalog(next);
      setEditingModelId(null);
      setForm(createEmptyForm(next.models.length));
      toast.success(`已删除模型 ${editingModelId}`);
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
    <div className="space-y-4 rounded-2xl border border-cyan-500/20 bg-cyan-500/5 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-cyan-100">
            <Boxes size={16} />
            顶层模型管理
          </div>
          <p className="mt-1 text-xs text-cyan-100/70">
            管理员可在这里新增、修改前台模型下拉项、尺寸规则、路线 family、图标和默认模型。
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadModels()}
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

      <div className="rounded-2xl border border-cyan-400/15 bg-black/20 p-4 text-sm text-gray-300">
        <div className="font-medium text-cyan-100">模型和线路怎么绑定</div>
        <div className="mt-2 space-y-2 text-xs leading-6 text-gray-400">
          <p>1. 模型的 <span className="text-cyan-200">routeFamily</span> 决定它会使用哪一组线路。</p>
          <p>2. 线路管理里的“线路族”必须和这里的 routeFamily 一致，前台选到这个模型时才会走到那些线路。</p>
          <p>3. 如果某个模型需要独立接口配置，就给它一个新的 routeFamily，再去线路管理里给这组 family 建专属线路。</p>
          <p>4. 如果只是请求模型名不同，但接口配置相同，可以共用线路，再通过 requestModel 区分。</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-3">
          <div className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
            <div className="mb-3 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-gray-400">
              <ShieldCheck size={13} />
              已配置模型
            </div>
            <div className="space-y-2">
              {sortedModels.length === 0 ? (
                <div className="rounded-lg border border-white/5 bg-white/[0.03] px-3 py-4 text-xs text-gray-400">
                  暂无模型数据
                </div>
              ) : (
                sortedModels.map((model) => (
                  <button
                    key={model.id}
                    type="button"
                    onClick={() => handleEdit(model)}
                    className={`w-full rounded-xl border px-3 py-3 text-left transition-colors ${
                      editingModelId === model.id
                        ? 'border-cyan-400/40 bg-cyan-500/10'
                        : 'border-white/5 bg-white/[0.03] hover:bg-white/[0.06]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-gray-100">
                          {model.label}
                        </div>
                        <div className="mt-1 truncate text-[11px] text-gray-500">
                          {model.id} / {model.routeFamily} / {model.panelLayout}
                        </div>
                        <div className="mt-1 truncate text-[11px] text-gray-400">
                          请求模型：{model.requestModel || model.id}
                        </div>
                        <div className="mt-1 truncate text-[11px] text-gray-500">
                          绑定线路族：{model.routeFamily}
                        </div>
                      </div>
                      <div className="shrink-0 text-right text-[11px] text-gray-300">
                        <div>{formatPoint(model.selectorCost || 0)} 点展示价</div>
                        <div className="mt-1 flex flex-wrap items-center justify-end gap-1">
                          {model.isActive ? (
                            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300">
                              启用
                            </span>
                          ) : (
                            <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-gray-400">
                              停用
                            </span>
                          )}
                          {model.isDefaultModel && (
                            <span className="rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] text-blue-300">
                              默认
                            </span>
                          )}
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
              {editingModelId ? `编辑 ${editingModelId}` : '新建模型'}
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
              当前模型会绑定到
              <span className="mx-1 font-medium text-cyan-200">
                {form.routeFamily || '未填写'}
              </span>
              这组线路。只要线路管理里的“线路族”也写成这个值，前台选中这个模型时就会走到那组线路。
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <input
                value={form.id}
                onChange={(event) => setForm((prev) => ({ ...prev, id: event.target.value }))}
                placeholder="model id，例如 custom-image-pro"
                disabled={Boolean(editingModelId)}
                className="h-10 rounded-lg border border-white/10 bg-black/25 px-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none disabled:opacity-60"
              />
              <input
                value={form.label}
                onChange={(event) => setForm((prev) => ({ ...prev, label: event.target.value }))}
                placeholder="显示名称"
                className="h-10 rounded-lg border border-white/10 bg-black/25 px-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
              />
            </div>

            <input
              value={form.description || ''}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, description: event.target.value }))
              }
              placeholder="模型描述"
              className="h-10 w-full rounded-lg border border-white/10 bg-black/25 px-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
            />

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <input
                value={form.modelFamily}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, modelFamily: event.target.value }))
                }
                placeholder="模型族，仅用于模型分类"
                className="h-10 rounded-lg border border-white/10 bg-black/25 px-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
              />
              <input
                value={form.routeFamily}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, routeFamily: event.target.value }))
                }
                placeholder="关联线路族，必须和线路管理里的线路族一致"
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
              <input
                value={form.requestModel || ''}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, requestModel: event.target.value }))
                }
                placeholder="真实上游模型名；线路勾选 useRequestModel 时会用这里"
                className="h-10 rounded-lg border border-white/10 bg-black/25 px-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
              />
              <input
                type="number"
                step="0.1"
                min="0"
                value={String(form.selectorCost || 0)}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    selectorCost: roundNonNegativePoint(event.target.value || 0, 0),
                  }))
                }
                placeholder="前台展示价"
                className="h-10 rounded-lg border border-white/10 bg-black/25 px-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
              />
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <select
                value={form.iconKind}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    iconKind: event.target.value as ModelFormState['iconKind'],
                  }))
                }
                className="h-10 rounded-lg border border-white/10 bg-black/25 px-3 text-sm text-white focus:border-white/20 focus:outline-none"
              >
                <option value="banana">banana</option>
                <option value="banana-zap">banana-zap</option>
                <option value="sparkles">sparkles</option>
                <option value="layers">layers</option>
                <option value="zap">zap</option>
                <option value="none">none</option>
              </select>
              <select
                value={form.panelLayout}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    panelLayout: event.target.value as ModelFormState['panelLayout'],
                  }))
                }
                className="h-10 rounded-lg border border-white/10 bg-black/25 px-3 text-sm text-white focus:border-white/20 focus:outline-none"
              >
                <option value="nano-banana">nano-banana</option>
                <option value="default">default</option>
                <option value="compact">compact</option>
              </select>
              <select
                value={form.sizeBehavior}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    sizeBehavior: event.target.value as ModelFormState['sizeBehavior'],
                  }))
                }
                className="h-10 rounded-lg border border-white/10 bg-black/25 px-3 text-sm text-white focus:border-white/20 focus:outline-none"
              >
                <option value="passthrough">passthrough</option>
                <option value="doubao-v5">doubao-v5</option>
                <option value="doubao-v45">doubao-v45</option>
                <option value="z-image-turbo">z-image-turbo</option>
              </select>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <input
                value={form.defaultSize || '1k'}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, defaultSize: event.target.value }))
                }
                placeholder="默认尺寸，例如 2k"
                className="h-10 rounded-lg border border-white/10 bg-black/25 px-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
              />
              <input
                value={form.sizeOptionsInput}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, sizeOptionsInput: event.target.value }))
                }
                placeholder="尺寸选项，用逗号分隔"
                className="h-10 rounded-lg border border-white/10 bg-black/25 px-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
              />
            </div>

            <input
              value={form.extraAspectRatiosInput}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  extraAspectRatiosInput: event.target.value,
                }))
              }
              placeholder="额外比例，用逗号分隔，例如 4:1, 1:4"
              className="h-10 w-full rounded-lg border border-white/10 bg-black/25 px-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
            />

            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-200">
                <input
                  type="checkbox"
                  checked={form.showSizeSelector !== false}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, showSizeSelector: event.target.checked }))
                  }
                />
                显示尺寸选择器
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-200">
                <input
                  type="checkbox"
                  checked={form.supportsCustomRatio !== false}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      supportsCustomRatio: event.target.checked,
                    }))
                  }
                />
                允许自定义比例
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-200">
                <input
                  type="checkbox"
                  checked={form.isActive !== false}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, isActive: event.target.checked }))
                  }
                />
                启用此模型
              </label>
              <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-200">
                <input
                  type="checkbox"
                  checked={form.isDefaultModel === true}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, isDefaultModel: event.target.checked }))
                  }
                />
                设为默认模型
              </label>
            </div>

            <div className="flex flex-wrap gap-3">
              {editingModelId && (
                <button
                  type="button"
                  onClick={() => void handleDelete()}
                  disabled={deleting || saving}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-red-500/30 bg-red-500/10 px-4 text-sm font-medium text-red-200 transition-colors hover:bg-red-500/20 disabled:opacity-60"
                >
                  {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  删除模型
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleSubmit()}
                disabled={saving || deleting}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-cyan-600 px-4 text-sm font-medium text-white transition-colors hover:bg-cyan-500 disabled:opacity-60"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                {editingModelId ? '保存修改' : '创建模型'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ModelAdminPanel;
