import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Boxes,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Copy,
  GripVertical,
  Loader2,
  Pencil,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  Save,
  Search,
  Trash2,
  X,
} from 'lucide-react';

import { AuthSessionPayload } from '../src/services/accountIdentity';
import { useToast } from '../src/context/ToastContext';
import {
  AdminDashboardModelStat,
  AdminDashboardPayload,
  AdminDashboardRouteStat,
} from '../src/services/adminDashboardService';
import {
  AdminImageModel,
  createAdminImageModel,
  deleteAdminImageModel,
  fetchAdminImageModels,
  type AdminImageModelPayload,
  updateAdminImageModel,
} from '../src/services/imageModelAdminService';
import {
  AdminImageRoute,
  createAdminImageRoute,
  deleteAdminImageRoute,
  fetchAdminImageRoutes,
  type AdminImageRoutePayload,
  updateAdminImageRoute,
} from '../src/services/imageRouteAdminService';
import {
  AdminVideoModel,
  createAdminVideoModel,
  deleteAdminVideoModel,
  fetchAdminVideoModels,
  type AdminVideoModelPayload,
  updateAdminVideoModel,
} from '../src/services/videoModelAdminService';
import {
  AdminVideoRoute,
  createAdminVideoRoute,
  deleteAdminVideoRoute,
  fetchAdminVideoRoutes,
  type AdminVideoRoutePayload,
  updateAdminVideoRoute,
} from '../src/services/videoRouteAdminService';
import { formatPoint, roundNonNegativePoint } from '../src/utils/pointFormat';

interface MediaCatalogAdminPanelProps {
  session: AuthSessionPayload | null;
  dashboard?: AdminDashboardPayload | null;
  onRefreshDashboard?: () => void;
}

type EditorState =
  | { kind: 'image-model'; mode: 'create' | 'edit'; targetId?: string }
  | { kind: 'image-route'; mode: 'create' | 'edit'; targetId?: string; family?: string }
  | { kind: 'video-model'; mode: 'create' | 'edit'; targetId?: string }
  | { kind: 'video-route'; mode: 'create' | 'edit'; targetId?: string; family?: string }
  | null;

type ImageModelForm = AdminImageModelPayload & {
  sizeOptionsInput: string;
  extraAspectRatiosInput: string;
};

type VideoModelForm = AdminVideoModelPayload & {
  referenceLabelsInput: string;
  aspectRatioOptionsInput: string;
  durationOptionsInput: string;
};

type ImageRouteSizeKey = '1k' | '2k' | '4k';

type ImageRouteForm = AdminImageRoutePayload & {
  size1kUpstreamModel: string;
  size1kPointCost: number;
  size2kUpstreamModel: string;
  size2kPointCost: number;
  size4kUpstreamModel: string;
  size4kPointCost: number;
};

type SelectionState = {
  imageModels: string[];
  imageRoutes: string[];
  videoModels: string[];
  videoRoutes: string[];
};

type CopyRoutesState = {
  media: 'image' | 'video';
  sourceModelId: string;
  targetModelId: string;
  overwrite: boolean;
} | null;

type DragState = {
  kind: 'image-model' | 'image-route' | 'video-model' | 'video-route';
  id: string;
  family?: string;
} | null;

const arrayToInput = (value?: string[]) => (Array.isArray(value) ? value.join(', ') : '');
const inputToArray = (value?: string) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
const slugify = (value: string, fallback = 'item') =>
  String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || fallback;
const sanitizeApiKeyInput = (value?: string) => {
  const cleaned = String(value || '').replace(/[\u0000-\u001F\u007F]/g, '').trim();
  if (!cleaned) return '';
  if (/^Bearer\s+/i.test(cleaned)) {
    const token = cleaned.replace(/^Bearer\s+/i, '').replace(/\s+/g, '');
    return token ? `Bearer ${token}` : '';
  }
  return cleaned.replace(/\s+/g, '');
};
const buildLineLabel = (line: string, fallbackLabel?: string) => {
  const match = String(line || '').trim().toLowerCase().match(/^line\s*([0-9]+)$/i);
  if (match?.[1]) return `Line ${match[1]}`;
  if (String(line || '').trim().toLowerCase() === 'default') return 'Default Route';
  return String(fallbackLabel || '').trim() || 'Route';
};
const IMAGE_ROUTE_SIZE_KEYS: ImageRouteSizeKey[] = ['1k', '2k', '4k'];
const IMAGE_ROUTE_SIZE_FIELD_MAP = {
  '1k': { modelField: 'size1kUpstreamModel', costField: 'size1kPointCost' },
  '2k': { modelField: 'size2kUpstreamModel', costField: 'size2kPointCost' },
  '4k': { modelField: 'size4kUpstreamModel', costField: 'size4kPointCost' },
} as const;
const getImageRouteSizeOverrideValue = (
  overrides: AdminImageRoutePayload['sizeOverrides'] | undefined,
  key: ImageRouteSizeKey,
) => overrides?.[key] || {};
const buildImageRouteSizeOverrides = (
  form: ImageRouteForm,
): AdminImageRoutePayload['sizeOverrides'] => {
  const next: NonNullable<AdminImageRoutePayload['sizeOverrides']> = {};
  IMAGE_ROUTE_SIZE_KEYS.forEach((key) => {
    const { modelField, costField } = IMAGE_ROUTE_SIZE_FIELD_MAP[key];
    const upstreamModel = String(form[modelField] || '').trim();
    const pointCost = roundNonNegativePoint(form[costField], 0);
    if (upstreamModel || pointCost > 0) {
      next[key] = {};
      if (upstreamModel) {
        next[key]!.upstreamModel = upstreamModel;
      }
      if (pointCost > 0) {
        next[key]!.pointCost = pointCost;
      }
    }
  });
  return Object.keys(next).length ? next : undefined;
};
const hasImageRouteSizeOverrideModel = (payload: AdminImageRoutePayload) =>
  IMAGE_ROUTE_SIZE_KEYS.some((key) => String(payload.sizeOverrides?.[key]?.upstreamModel || '').trim());
const getNextLineValue = (lines: string[]) => {
  const nums = lines
    .map((line) => String(line || '').match(/^line\s*([0-9]+)$/i)?.[1])
    .map((value) => Number(value || 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  return `line${nums.length ? Math.max(...nums) + 1 : 1}`;
};
const nextSortOrder = (items: Array<{ sortOrder?: number }>) =>
  items.length ? Math.max(...items.map((item) => Number(item.sortOrder || 0))) + 10 : 10;
const formatTime = (value?: string | null) => (value ? new Date(value).toLocaleString() : '暂无数据');
const formatRate = (value?: number | null) => `${Number(value || 0).toFixed(1)}%`;
const statTone = (value?: number | null) => {
  const next = Number(value || 0);
  if (next >= 95) return 'border-emerald-500/20 bg-emerald-500/15 text-emerald-100';
  if (next >= 80) return 'border-amber-500/20 bg-amber-500/15 text-amber-100';
  return 'border-rose-500/20 bg-rose-500/15 text-rose-100';
};
const sortByOrder = <T extends { sortOrder?: number; label?: string }>(items: T[]) =>
  [...items].sort((left, right) => {
    if (Number(left.sortOrder || 0) !== Number(right.sortOrder || 0)) {
      return Number(left.sortOrder || 0) - Number(right.sortOrder || 0);
    }
    return String(left.label || '').localeCompare(String(right.label || ''));
  });
const emptySelection = (): SelectionState => ({
  imageModels: [],
  imageRoutes: [],
  videoModels: [],
  videoRoutes: [],
});
const toggleId = (list: string[], id: string, checked: boolean) =>
  checked ? Array.from(new Set([...list, id])) : list.filter((item) => item !== id);
const uniqueValue = (base: string, used: Set<string>) => {
  const normalized = slugify(base, 'item');
  if (!used.has(normalized)) {
    used.add(normalized);
    return normalized;
  }
  let index = 2;
  while (used.has(`${normalized}-${index}`)) index += 1;
  const next = `${normalized}-${index}`;
  used.add(next);
  return next;
};
const moveArrayItem = <T,>(items: T[], fromIndex: number, toIndex: number) => {
  const next = [...items];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
};

const Input = (props: React.InputHTMLAttributes<HTMLInputElement>) => (
  <input
    {...props}
    className={`h-10 w-full rounded-xl border border-white/10 bg-black/25 px-3 text-sm text-white placeholder:text-gray-500 ${props.className || ''}`}
  />
);
const Textarea = (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) => (
  <textarea
    {...props}
    className={`min-h-[96px] w-full rounded-2xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-white placeholder:text-gray-500 ${props.className || ''}`}
  />
);
const Select = (props: React.SelectHTMLAttributes<HTMLSelectElement>) => (
  <select
    {...props}
    className={`h-10 w-full rounded-xl border border-white/10 bg-black/25 px-3 text-sm text-white ${props.className || ''}`}
  />
);
const Toggle = ({ checked, onChange, label }: { checked: boolean; onChange: (checked: boolean) => void; label: string }) => (
  <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-200">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    {label}
  </label>
);
const ActionButton = ({
  onClick,
  children,
  tone = 'default',
  disabled,
  icon,
}: {
  onClick?: () => void;
  children: React.ReactNode;
  tone?: 'default' | 'primary' | 'success' | 'warning' | 'danger';
  disabled?: boolean;
  icon?: React.ReactNode;
}) => {
  const toneClass =
    tone === 'primary'
      ? 'border-cyan-500/30 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/20'
      : tone === 'success'
        ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-100 hover:bg-emerald-500/20'
        : tone === 'warning'
          ? 'border-amber-500/30 bg-amber-500/15 text-amber-100 hover:bg-amber-500/20'
          : tone === 'danger'
            ? 'border-rose-500/30 bg-rose-500/15 text-rose-100 hover:bg-rose-500/20'
            : 'border-white/10 bg-white/5 text-white hover:bg-white/10';
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition ${toneClass} disabled:cursor-not-allowed disabled:opacity-40`}
    >
      {icon}
      {children}
    </button>
  );
};
const SectionPill = ({ children, className = '' }: { children: React.ReactNode; className?: string }) => (
  <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] ${className || 'border-white/10 bg-white/5 text-gray-200'}`}>
    {children}
  </span>
);
const HelpText = ({ children }: { children: React.ReactNode }) => <p className="text-xs leading-5 text-gray-400">{children}</p>;

const createImageModelForm = (model?: Partial<AdminImageModel>): ImageModelForm => ({
  id: String(model?.id || '').trim(),
  label: String(model?.label || '').trim(),
  description: String(model?.description || '').trim(),
  modelFamily: String(model?.modelFamily || '').trim(),
  routeFamily: String(model?.routeFamily || '').trim(),
  requestModel: String(model?.requestModel || '').trim(),
  selectorCost: roundNonNegativePoint(model?.selectorCost || 0, 0),
  iconKind: model?.iconKind || 'banana',
  panelLayout: model?.panelLayout || 'default',
  sizeBehavior: model?.sizeBehavior || 'passthrough',
  defaultSize: String(model?.defaultSize || '1k').trim(),
  sizeOptions: [],
  extraAspectRatios: [],
  sizeOptionsInput: arrayToInput(model?.sizeOptions || ['1k', '2k', '4k']),
  extraAspectRatiosInput: arrayToInput(model?.extraAspectRatios || []),
  showSizeSelector: model?.showSizeSelector !== false,
  supportsCustomRatio: model?.supportsCustomRatio !== false,
  isActive: model?.isActive !== false,
  isDefaultModel: model?.isDefaultModel === true,
  sortOrder: Number(model?.sortOrder || 0),
});

const createImageRouteForm = (route?: Partial<AdminImageRoute>, family = 'default'): ImageRouteForm => {
  const size1k = getImageRouteSizeOverrideValue(route?.sizeOverrides, '1k');
  const size2k = getImageRouteSizeOverrideValue(route?.sizeOverrides, '2k');
  const size4k = getImageRouteSizeOverrideValue(route?.sizeOverrides, '4k');
  return {
    id: String(route?.id || '').trim(),
    label: String(route?.label || '').trim(),
    description: String(route?.description || '').trim(),
    modelFamily: String(route?.modelFamily || family).trim(),
    line: String(route?.line || 'line1').trim(),
    transport: route?.transport || 'openai-image',
    mode: route?.mode || 'async',
    baseUrl: String(route?.baseUrl || '').trim(),
    generatePath: String(route?.generatePath || '/v1/images/generations?async=true').trim(),
    taskPath: String(route?.taskPath || '/v1/images/tasks/{taskId}').trim(),
    editPath: String(route?.editPath || '/v1/images/edits?async=true').trim(),
    chatPath: String(route?.chatPath || '').trim(),
    upstreamModel: String(route?.upstreamModel || '').trim(),
    useRequestModel: route?.useRequestModel === true,
    allowUserApiKeyWithoutLogin: route?.allowUserApiKeyWithoutLogin === true,
    apiKeyEnv: String(route?.apiKeyEnv || '').trim(),
    apiKey: '',
    pointCost: roundNonNegativePoint(route?.pointCost || 5, 0),
    sizeOverrides: route?.sizeOverrides,
    size1kUpstreamModel: String(size1k.upstreamModel || '').trim(),
    size1kPointCost: roundNonNegativePoint(size1k.pointCost || 0, 0),
    size2kUpstreamModel: String(size2k.upstreamModel || '').trim(),
    size2kPointCost: roundNonNegativePoint(size2k.pointCost || 0, 0),
    size4kUpstreamModel: String(size4k.upstreamModel || '').trim(),
    size4kPointCost: roundNonNegativePoint(size4k.pointCost || 0, 0),
    sortOrder: Number(route?.sortOrder || 0),
    isActive: route?.isActive !== false,
    isDefaultRoute: route?.isDefaultRoute === true,
    isDefaultNanoBananaLine: route?.isDefaultNanoBananaLine === true,
  };
};
const createVideoModelForm = (model?: Partial<AdminVideoModel>): VideoModelForm => ({
  id: String(model?.id || '').trim(),
  label: String(model?.label || '').trim(),
  description: String(model?.description || '').trim(),
  modelFamily: String(model?.modelFamily || '').trim(),
  routeFamily: String(model?.routeFamily || '').trim(),
  requestModel: String(model?.requestModel || '').trim(),
  selectorCost: roundNonNegativePoint(model?.selectorCost || 0, 0),
  maxReferenceImages: Number(model?.maxReferenceImages || 1),
  referenceLabels: [],
  referenceLabelsInput: arrayToInput(model?.referenceLabels || []),
  defaultAspectRatio: String(model?.defaultAspectRatio || '16:9').trim(),
  aspectRatioOptions: [],
  aspectRatioOptionsInput: arrayToInput(model?.aspectRatioOptions || ['16:9', '9:16']),
  defaultDuration: String(model?.defaultDuration || '4').trim(),
  durationOptions: [],
  durationOptionsInput: arrayToInput(model?.durationOptions || ['4', '6', '8']),
  supportsHd: model?.supportsHd === true,
  defaultHd: model?.defaultHd === true,
  isActive: model?.isActive !== false,
  isDefaultModel: model?.isDefaultModel === true,
  sortOrder: Number(model?.sortOrder || 0),
});

const createVideoRouteForm = (route?: Partial<AdminVideoRoute>, family = 'default'): AdminVideoRoutePayload => ({
  id: String(route?.id || '').trim(),
  label: String(route?.label || '').trim(),
  description: String(route?.description || '').trim(),
  routeFamily: String(route?.routeFamily || family).trim(),
  line: String(route?.line || 'line1').trim(),
  transport: 'openai-video',
  mode: 'async',
  baseUrl: String(route?.baseUrl || '').trim(),
  generatePath: String(route?.generatePath || '/v2/videos/generations').trim(),
  taskPath: String(route?.taskPath || '/v2/videos/tasks/{taskId}').trim(),
  upstreamModel: String(route?.upstreamModel || '').trim(),
  useRequestModel: route?.useRequestModel === true,
  allowUserApiKeyWithoutLogin: route?.allowUserApiKeyWithoutLogin === true,
  apiKeyEnv: String(route?.apiKeyEnv || '').trim(),
  apiKey: '',
  pointCost: roundNonNegativePoint(route?.pointCost || 10, 0),
  sortOrder: Number(route?.sortOrder || 0),
  isActive: route?.isActive !== false,
  isDefaultRoute: route?.isDefaultRoute === true,
});

const applyImageRoutePreset = <T extends AdminImageRoutePayload>(
  route: T,
  preset: 'openai' | 'gemini',
): T =>
  preset === 'openai'
    ? { ...route, transport: 'openai-image' as const, mode: 'async' as const, generatePath: '/v1/images/generations?async=true', taskPath: '/v1/images/tasks/{taskId}', editPath: '/v1/images/edits?async=true', chatPath: '', useRequestModel: false, allowUserApiKeyWithoutLogin: false }
    : { ...route, transport: 'gemini-native' as const, mode: 'sync' as const, generatePath: '/v1beta/models/{model}:generateContent', taskPath: '', editPath: '', chatPath: '', useRequestModel: false, allowUserApiKeyWithoutLogin: false };

const validateImageRoutePayload = (payload: AdminImageRoutePayload) => {
  const generatePath = String(payload.generatePath || '').trim();
  if (!payload.id || !payload.label || !payload.modelFamily || !payload.line || !payload.baseUrl) return '图片线路请至少填写 route id、显示名称、线路族、line 和 baseUrl。';
  if (payload.transport === 'openai-image' && /generatecontent/i.test(generatePath)) return 'OpenAI 图片线路不能填写 Gemini generateContent 接口。';
  if (payload.transport === 'openai-image' && payload.mode === 'async' && !String(payload.taskPath || '').trim()) return 'OpenAI 异步图片线路必须填写 taskPath。';
  if (payload.transport === 'gemini-native' && payload.mode !== 'sync') return 'Gemini 原生图片线路只能使用 sync 模式。';
  if (payload.transport === 'gemini-native' && !/\{model\}/.test(generatePath)) return 'Gemini 原生线路的 generatePath 必须包含 {model}。';
  if (payload.transport === 'gemini-native' && !payload.useRequestModel && !String(payload.upstreamModel || '').trim() && !hasImageRouteSizeOverrideModel(payload)) return 'Gemini 原生线路需要填写默认 upstreamModel、尺寸覆写模型，或开启“使用模型请求名”。';
  if (payload.allowUserApiKeyWithoutLogin && !(payload.transport === 'openai-image' && payload.mode === 'async')) return '“允许用户 API Key 免登录”只适用于 OpenAI 兼容异步图片线路。';
  return null;
};

const validateVideoRoutePayload = (payload: AdminVideoRoutePayload) => {
  if (!payload.id || !payload.label || !payload.routeFamily || !payload.line || !payload.baseUrl) return '视频线路请至少填写 route id、显示名称、线路族、line 和 baseUrl。';
  if (!String(payload.taskPath || '').trim()) return '视频异步线路必须填写 taskPath。';
  if (!payload.useRequestModel && !String(payload.upstreamModel || '').trim()) return '视频线路需要填写 upstreamModel，或开启“使用模型请求名”。';
  return null;
};

const MediaCatalogAdminPanel: React.FC<MediaCatalogAdminPanelProps> = ({ session, dashboard, onRefreshDashboard }) => {
  const toast = useToast();
  const isSuperAdmin = session?.user?.isSuperAdmin === true;
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState('');
  const [imageModels, setImageModels] = useState<AdminImageModel[]>([]);
  const [imageRoutes, setImageRoutes] = useState<AdminImageRoute[]>([]);
  const [videoModels, setVideoModels] = useState<AdminVideoModel[]>([]);
  const [videoRoutes, setVideoRoutes] = useState<AdminVideoRoute[]>([]);
  const [collapsedSections, setCollapsedSections] = useState({ image: false, video: false });
  const [collapsedModels, setCollapsedModels] = useState<Record<string, boolean>>({});
  const [editor, setEditor] = useState<EditorState>(null);
  const [imageModelForm, setImageModelForm] = useState(createImageModelForm());
  const [imageRouteForm, setImageRouteForm] = useState(createImageRouteForm());
  const [videoModelForm, setVideoModelForm] = useState(createVideoModelForm());
  const [videoRouteForm, setVideoRouteForm] = useState(createVideoRouteForm());
  const [selection, setSelection] = useState<SelectionState>(emptySelection());
  const [copyRoutesState, setCopyRoutesState] = useState<CopyRoutesState>(null);
  const [dragState, setDragState] = useState<DragState>(null);
  const [dropIndicator, setDropIndicator] = useState<DragState>(null);

  const imageRouteStats = useMemo(() => new Map((dashboard?.imageRouteStats || []).map((item) => [item.routeId, item])), [dashboard?.imageRouteStats]);
  const imageModelStats = useMemo(() => new Map((dashboard?.imageModelStats || []).map((item) => [item.modelId || item.modelKey, item])), [dashboard?.imageModelStats]);
  const videoRouteStats = useMemo(() => new Map((dashboard?.videoRouteStats || []).map((item) => [item.routeId, item])), [dashboard?.videoRouteStats]);
  const videoModelStats = useMemo(() => new Map((dashboard?.videoModelStats || []).map((item) => [item.modelId || item.modelKey, item])), [dashboard?.videoModelStats]);
  const q = searchInput.trim().toLowerCase();

  const getImageRoutesForModel = useCallback((model: AdminImageModel) => sortByOrder(imageRoutes.filter((route) => route.modelFamily === model.routeFamily)), [imageRoutes]);
  const getVideoRoutesForModel = useCallback((model: AdminVideoModel) => sortByOrder(videoRoutes.filter((route) => route.routeFamily === model.routeFamily)), [videoRoutes]);

  const loadCatalog = useCallback(async () => {
    if (!isSuperAdmin) return;
    setLoading(true);
    setError(null);
    try {
      const [im, ir, vm, vr] = await Promise.all([fetchAdminImageModels(), fetchAdminImageRoutes(), fetchAdminVideoModels(), fetchAdminVideoRoutes()]);
      setImageModels(sortByOrder(im.models));
      setImageRoutes(sortByOrder(ir.routes));
      setVideoModels(sortByOrder(vm.models));
      setVideoRoutes(sortByOrder(vr.routes));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [isSuperAdmin]);

  useEffect(() => { void loadCatalog(); }, [loadCatalog]);
  const refreshAll = useCallback(async () => { await loadCatalog(); onRefreshDashboard?.(); }, [loadCatalog, onRefreshDashboard]);

  const filteredImageModels = useMemo(() => {
    const models = sortByOrder(imageModels);
    if (!q) return models;
    return models.filter((model) => [model.id, model.label, model.description, model.modelFamily, model.routeFamily, ...getImageRoutesForModel(model).flatMap((route) => [route.id, route.label, route.description, route.line, route.baseUrl, route.transport])].join(' ').toLowerCase().includes(q));
  }, [imageModels, getImageRoutesForModel, q]);
  const filteredVideoModels = useMemo(() => {
    const models = sortByOrder(videoModels);
    if (!q) return models;
    return models.filter((model) => [model.id, model.label, model.description, model.modelFamily, model.routeFamily, ...getVideoRoutesForModel(model).flatMap((route) => [route.id, route.label, route.description, route.line, route.baseUrl, route.transport])].join(' ').toLowerCase().includes(q));
  }, [videoModels, getVideoRoutesForModel, q]);

  const clearSelection = useCallback((media: 'image' | 'video') => {
    setSelection((prev) => (media === 'image' ? { ...prev, imageModels: [], imageRoutes: [] } : { ...prev, videoModels: [], videoRoutes: [] }));
  }, []);
  const resetEditor = useCallback(() => {
    setEditor(null);
    setImageModelForm(createImageModelForm());
    setImageRouteForm(createImageRouteForm());
    setVideoModelForm(createVideoModelForm());
    setVideoRouteForm(createVideoRouteForm());
  }, []);

  const openCreateImageModel = useCallback(() => {
    const id = uniqueValue('image-model', new Set(imageModels.map((item) => item.id)));
    setImageModelForm(createImageModelForm({ id, label: '新图片模型', modelFamily: slugify(id, 'image-family'), routeFamily: slugify(id, 'image-family'), sortOrder: nextSortOrder(imageModels) }));
    setEditor({ kind: 'image-model', mode: 'create' });
  }, [imageModels]);
  const openEditImageModel = useCallback((model: AdminImageModel) => { setImageModelForm(createImageModelForm(model)); setEditor({ kind: 'image-model', mode: 'edit', targetId: model.id }); }, []);
  const openCreateImageRoute = useCallback((model: AdminImageModel) => {
    const modelRoutes = getImageRoutesForModel(model);
    const nextLine = getNextLineValue(modelRoutes.map((route) => route.line));
    const suggestedId = uniqueValue(`${model.id}-${nextLine}`, new Set(imageRoutes.map((route) => route.id)));
    setImageRouteForm(createImageRouteForm({ id: suggestedId, label: buildLineLabel(nextLine), modelFamily: model.routeFamily, line: nextLine, sortOrder: nextSortOrder(modelRoutes), pointCost: modelRoutes[0]?.pointCost || 5 }, model.routeFamily));
    setEditor({ kind: 'image-route', mode: 'create', family: model.routeFamily });
  }, [getImageRoutesForModel, imageRoutes]);
  const openEditImageRoute = useCallback((route: AdminImageRoute) => { setImageRouteForm(createImageRouteForm(route, route.modelFamily)); setEditor({ kind: 'image-route', mode: 'edit', targetId: route.id, family: route.modelFamily }); }, []);
  const openCreateVideoModel = useCallback(() => {
    const id = uniqueValue('video-model', new Set(videoModels.map((item) => item.id)));
    setVideoModelForm(createVideoModelForm({ id, label: '新视频模型', modelFamily: slugify(id, 'video-family'), routeFamily: slugify(id, 'video-family'), sortOrder: nextSortOrder(videoModels) }));
    setEditor({ kind: 'video-model', mode: 'create' });
  }, [videoModels]);
  const openEditVideoModel = useCallback((model: AdminVideoModel) => { setVideoModelForm(createVideoModelForm(model)); setEditor({ kind: 'video-model', mode: 'edit', targetId: model.id }); }, []);
  const openCreateVideoRoute = useCallback((model: AdminVideoModel) => {
    const modelRoutes = getVideoRoutesForModel(model);
    const nextLine = getNextLineValue(modelRoutes.map((route) => route.line));
    const suggestedId = uniqueValue(`${model.id}-${nextLine}`, new Set(videoRoutes.map((route) => route.id)));
    setVideoRouteForm(createVideoRouteForm({ id: suggestedId, label: buildLineLabel(nextLine), routeFamily: model.routeFamily, line: nextLine, sortOrder: nextSortOrder(modelRoutes), pointCost: modelRoutes[0]?.pointCost || 10 }, model.routeFamily));
    setEditor({ kind: 'video-route', mode: 'create', family: model.routeFamily });
  }, [getVideoRoutesForModel, videoRoutes]);
  const openEditVideoRoute = useCallback((route: AdminVideoRoute) => { setVideoRouteForm(createVideoRouteForm(route, route.routeFamily)); setEditor({ kind: 'video-route', mode: 'edit', targetId: route.id, family: route.routeFamily }); }, []);
  const saveEditor = useCallback(async () => {
    if (!editor) return;
    setSaving(true);
    setError(null);
    try {
      if (editor.kind === 'image-model') {
        const payload: AdminImageModelPayload = { ...imageModelForm, id: slugify(imageModelForm.id, 'image-model'), label: imageModelForm.label.trim(), description: imageModelForm.description?.trim() || '', modelFamily: imageModelForm.modelFamily.trim(), routeFamily: imageModelForm.routeFamily.trim(), requestModel: imageModelForm.requestModel?.trim() || '', sizeOptions: inputToArray(imageModelForm.sizeOptionsInput), extraAspectRatios: inputToArray(imageModelForm.extraAspectRatiosInput), sortOrder: Number(imageModelForm.sortOrder || 0), selectorCost: roundNonNegativePoint(imageModelForm.selectorCost || 0, 0), defaultSize: String(imageModelForm.defaultSize || '').trim() || '1k' };
        if (!payload.id || !payload.label || !payload.modelFamily || !payload.routeFamily) throw new Error('图片模型请至少填写 ID、显示名称、模型族和线路族。');
        if (editor.mode === 'create') { await createAdminImageModel(payload); toast.success('图片模型已创建。'); } else { await updateAdminImageModel(editor.targetId || payload.id, payload); toast.success('图片模型已更新。'); }
      }
      if (editor.kind === 'image-route') {
        const payload: AdminImageRoutePayload = {
          ...imageRouteForm,
          id: String(imageRouteForm.id || '').trim(),
          label: imageRouteForm.label.trim() || buildLineLabel(imageRouteForm.line),
          description: imageRouteForm.description?.trim() || '',
          modelFamily: imageRouteForm.modelFamily.trim(),
          line: imageRouteForm.line.trim().toLowerCase(),
          baseUrl: imageRouteForm.baseUrl.trim(),
          generatePath: imageRouteForm.generatePath.trim(),
          taskPath: imageRouteForm.taskPath?.trim() || '',
          editPath: imageRouteForm.editPath?.trim() || '',
          chatPath: imageRouteForm.chatPath?.trim() || '',
          upstreamModel: imageRouteForm.upstreamModel?.trim() || '',
          apiKeyEnv: imageRouteForm.apiKeyEnv?.trim() || '',
          apiKey: sanitizeApiKeyInput(imageRouteForm.apiKey),
          pointCost: roundNonNegativePoint(imageRouteForm.pointCost || 0, 0),
          sizeOverrides: buildImageRouteSizeOverrides(imageRouteForm),
          sortOrder: Number(imageRouteForm.sortOrder || 0),
        };
        const validationError = validateImageRoutePayload(payload);
        if (validationError) throw new Error(validationError);
        if (editor.mode === 'create') { await createAdminImageRoute(payload); toast.success('图片线路已创建。'); } else { await updateAdminImageRoute(editor.targetId || payload.id, payload); toast.success('图片线路已更新。'); }
      }
      if (editor.kind === 'video-model') {
        const payload: AdminVideoModelPayload = { ...videoModelForm, id: slugify(videoModelForm.id, 'video-model'), label: videoModelForm.label.trim(), description: videoModelForm.description?.trim() || '', modelFamily: videoModelForm.modelFamily.trim(), routeFamily: videoModelForm.routeFamily.trim(), requestModel: videoModelForm.requestModel?.trim() || '', referenceLabels: inputToArray(videoModelForm.referenceLabelsInput), aspectRatioOptions: inputToArray(videoModelForm.aspectRatioOptionsInput), durationOptions: inputToArray(videoModelForm.durationOptionsInput), defaultAspectRatio: String(videoModelForm.defaultAspectRatio || '').trim() || '16:9', defaultDuration: String(videoModelForm.defaultDuration || '').trim() || '4', selectorCost: roundNonNegativePoint(videoModelForm.selectorCost || 0, 0), maxReferenceImages: Number(videoModelForm.maxReferenceImages || 1), sortOrder: Number(videoModelForm.sortOrder || 0) };
        if (!payload.id || !payload.label || !payload.modelFamily || !payload.routeFamily) throw new Error('视频模型请至少填写 ID、显示名称、模型族和线路族。');
        if (editor.mode === 'create') { await createAdminVideoModel(payload); toast.success('视频模型已创建。'); } else { await updateAdminVideoModel(editor.targetId || payload.id, payload); toast.success('视频模型已更新。'); }
      }
      if (editor.kind === 'video-route') {
        const payload: AdminVideoRoutePayload = { ...videoRouteForm, id: String(videoRouteForm.id || '').trim(), label: videoRouteForm.label.trim() || buildLineLabel(videoRouteForm.line), description: videoRouteForm.description?.trim() || '', routeFamily: videoRouteForm.routeFamily.trim(), line: videoRouteForm.line.trim().toLowerCase(), baseUrl: videoRouteForm.baseUrl.trim(), generatePath: videoRouteForm.generatePath.trim(), taskPath: videoRouteForm.taskPath?.trim() || '', upstreamModel: videoRouteForm.upstreamModel?.trim() || '', apiKeyEnv: videoRouteForm.apiKeyEnv?.trim() || '', apiKey: sanitizeApiKeyInput(videoRouteForm.apiKey), pointCost: roundNonNegativePoint(videoRouteForm.pointCost || 0, 0), sortOrder: Number(videoRouteForm.sortOrder || 0) };
        const validationError = validateVideoRoutePayload(payload);
        if (validationError) throw new Error(validationError);
        if (editor.mode === 'create') { await createAdminVideoRoute(payload); toast.success('视频线路已创建。'); } else { await updateAdminVideoRoute(editor.targetId || payload.id, payload); toast.success('视频线路已更新。'); }
      }
      await refreshAll();
      resetEditor();
    } catch (err) {
      const message = (err as Error).message || '保存失败';
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }, [editor, imageModelForm, imageRouteForm, videoModelForm, videoRouteForm, refreshAll, resetEditor, toast]);

  const deleteImageModelWithRoutes = useCallback(async (modelId: string) => {
    const model = imageModels.find((item) => item.id === modelId);
    if (!model) return;
    const routes = getImageRoutesForModel(model);
    if (!window.confirm(`确定删除图片模型“${model.label}”吗？这会同时删除它下面的 ${routes.length} 条线路。`)) return;
    setSaving(true);
    try {
      await Promise.all(routes.map((route) => deleteAdminImageRoute(route.id)));
      await deleteAdminImageModel(modelId);
      toast.success('图片模型及其线路已删除。');
      clearSelection('image');
      await refreshAll();
    } catch (err) {
      toast.error((err as Error).message || '删除失败');
    } finally { setSaving(false); }
  }, [clearSelection, getImageRoutesForModel, imageModels, refreshAll, toast]);

  const deleteVideoModelWithRoutes = useCallback(async (modelId: string) => {
    const model = videoModels.find((item) => item.id === modelId);
    if (!model) return;
    const routes = getVideoRoutesForModel(model);
    if (!window.confirm(`确定删除视频模型“${model.label}”吗？这会同时删除它下面的 ${routes.length} 条线路。`)) return;
    setSaving(true);
    try {
      await Promise.all(routes.map((route) => deleteAdminVideoRoute(route.id)));
      await deleteAdminVideoModel(modelId);
      toast.success('视频模型及其线路已删除。');
      clearSelection('video');
      await refreshAll();
    } catch (err) {
      toast.error((err as Error).message || '删除失败');
    } finally { setSaving(false); }
  }, [clearSelection, getVideoRoutesForModel, refreshAll, toast, videoModels]);

  const deleteImageRouteWithConfirm = useCallback(async (routeId: string) => {
    const route = imageRoutes.find((item) => item.id === routeId);
    if (!route) return;
    if (!window.confirm(`确定删除图片线路“${route.label}”吗？`)) return;
    setSaving(true);
    try {
      await deleteAdminImageRoute(routeId);
      toast.success('图片线路已删除。');
      clearSelection('image');
      await refreshAll();
    } catch (err) {
      toast.error((err as Error).message || '删除失败');
    } finally { setSaving(false); }
  }, [clearSelection, imageRoutes, refreshAll, toast]);

  const deleteVideoRouteWithConfirm = useCallback(async (routeId: string) => {
    const route = videoRoutes.find((item) => item.id === routeId);
    if (!route) return;
    if (!window.confirm(`确定删除视频线路“${route.label}”吗？`)) return;
    setSaving(true);
    try {
      await deleteAdminVideoRoute(routeId);
      toast.success('视频线路已删除。');
      clearSelection('video');
      await refreshAll();
    } catch (err) {
      toast.error((err as Error).message || '删除失败');
    } finally { setSaving(false); }
  }, [clearSelection, refreshAll, toast, videoRoutes]);

  const toggleSectionCollapse = useCallback((media: 'image' | 'video') => { setCollapsedSections((prev) => ({ ...prev, [media]: !prev[media] })); }, []);
  const toggleModelCollapse = useCallback((modelId: string) => { setCollapsedModels((prev) => ({ ...prev, [modelId]: !prev[modelId] })); }, []);
  const setItemSelected = useCallback((key: keyof SelectionState, id: string, checked: boolean) => setSelection((prev) => ({ ...prev, [key]: toggleId(prev[key], id, checked) })), []);
  const selectVisibleItems = useCallback((media: 'image' | 'video', kind: 'models' | 'routes') => {
    if (media === 'image') {
      const modelIds = filteredImageModels.map((model) => model.id);
      const routeIds = filteredImageModels.flatMap((model) => getImageRoutesForModel(model).map((route) => route.id));
      setSelection((prev) => ({ ...prev, imageModels: kind === 'models' ? modelIds : prev.imageModels, imageRoutes: kind === 'routes' ? routeIds : prev.imageRoutes }));
      return;
    }
    const modelIds = filteredVideoModels.map((model) => model.id);
    const routeIds = filteredVideoModels.flatMap((model) => getVideoRoutesForModel(model).map((route) => route.id));
    setSelection((prev) => ({ ...prev, videoModels: kind === 'models' ? modelIds : prev.videoModels, videoRoutes: kind === 'routes' ? routeIds : prev.videoRoutes }));
  }, [filteredImageModels, filteredVideoModels, getImageRoutesForModel, getVideoRoutesForModel]);

  const bulkToggle = useCallback(async (media: 'image' | 'video', active: boolean) => {
    const modelIds = media === 'image' ? selection.imageModels : selection.videoModels;
    const routeIds = media === 'image' ? selection.imageRoutes : selection.videoRoutes;
    if (!modelIds.length && !routeIds.length) { toast.info('请先勾选模型或线路。'); return; }
    setSaving(true);
    try {
      if (media === 'image') {
        await Promise.all([...modelIds.map((id) => updateAdminImageModel(id, { isActive: active })), ...routeIds.map((id) => updateAdminImageRoute(id, { isActive: active }))]);
      } else {
        await Promise.all([...modelIds.map((id) => updateAdminVideoModel(id, { isActive: active })), ...routeIds.map((id) => updateAdminVideoRoute(id, { isActive: active }))]);
      }
      toast.success(active ? '已启用选中项。' : '已停用选中项。');
      clearSelection(media);
      await refreshAll();
    } catch (err) {
      toast.error((err as Error).message || '批量更新失败');
    } finally { setSaving(false); }
  }, [clearSelection, refreshAll, selection, toast]);

  const bulkDelete = useCallback(async (media: 'image' | 'video') => {
    const modelIds = media === 'image' ? selection.imageModels : selection.videoModels;
    const routeIds = media === 'image' ? selection.imageRoutes : selection.videoRoutes;
    if (!modelIds.length && !routeIds.length) { toast.info('请先勾选需要删除的模型或线路。'); return; }
    if (!window.confirm(`确定删除选中的 ${modelIds.length} 个模型和 ${routeIds.length} 条线路吗？`)) return;
    setSaving(true);
    try {
      if (media === 'image') {
        const routeIdSet = new Set(routeIds);
        modelIds.forEach((modelId) => { const model = imageModels.find((item) => item.id === modelId); if (model) getImageRoutesForModel(model).forEach((route) => routeIdSet.add(route.id)); });
        await Promise.all(Array.from(routeIdSet).map((id) => deleteAdminImageRoute(id)));
        await Promise.all(modelIds.map((id) => deleteAdminImageModel(id)));
      } else {
        const routeIdSet = new Set(routeIds);
        modelIds.forEach((modelId) => { const model = videoModels.find((item) => item.id === modelId); if (model) getVideoRoutesForModel(model).forEach((route) => routeIdSet.add(route.id)); });
        await Promise.all(Array.from(routeIdSet).map((id) => deleteAdminVideoRoute(id)));
        await Promise.all(modelIds.map((id) => deleteAdminVideoModel(id)));
      }
      toast.success('选中项已删除。');
      clearSelection(media);
      await refreshAll();
    } catch (err) {
      toast.error((err as Error).message || '批量删除失败');
    } finally { setSaving(false); }
  }, [clearSelection, getImageRoutesForModel, getVideoRoutesForModel, imageModels, refreshAll, selection, toast, videoModels]);

  const openCopyRoutes = useCallback((media: 'image' | 'video', sourceModelId: string) => { setCopyRoutesState({ media, sourceModelId, targetModelId: '', overwrite: false }); }, []);
  const executeCopyRoutes = useCallback(async () => {
    if (!copyRoutesState) return;
    if (!copyRoutesState.targetModelId) { toast.error('请先选择目标模型。'); return; }
    if (copyRoutesState.targetModelId === copyRoutesState.sourceModelId) { toast.error('源模型和目标模型不能相同。'); return; }
    setSaving(true);
    try {
      if (copyRoutesState.media === 'image') {
        const sourceModel = imageModels.find((item) => item.id === copyRoutesState.sourceModelId);
        const targetModel = imageModels.find((item) => item.id === copyRoutesState.targetModelId);
        if (!sourceModel || !targetModel) throw new Error('图片模型不存在。');
        const sourceRoutes = getImageRoutesForModel(sourceModel);
        const targetRoutes = getImageRoutesForModel(targetModel);
        if (!sourceRoutes.length) throw new Error('源模型下没有可复制的线路。');
        if (copyRoutesState.overwrite) await Promise.all(targetRoutes.map((route) => deleteAdminImageRoute(route.id)));
        const usedIds = new Set(imageRoutes.filter((route) => copyRoutesState.overwrite || route.modelFamily !== targetModel.routeFamily || !targetRoutes.some((target) => target.id === route.id)).map((route) => route.id));
        const usedLines = copyRoutesState.overwrite ? [] : targetRoutes.map((route) => route.line);
        const hiddenKeys = sourceRoutes.some((route) => route.hasApiKey);
        const baseOrder = copyRoutesState.overwrite ? 0 : Math.max(0, ...targetRoutes.map((route) => Number(route.sortOrder || 0)));
        for (const [index, route] of sourceRoutes.entries()) {
          const line = copyRoutesState.overwrite || !usedLines.includes(route.line) ? route.line : getNextLineValue(usedLines);
          usedLines.push(line);
          await createAdminImageRoute({
            id: uniqueValue(`${targetModel.id}-${line}`, usedIds),
            label: route.label || buildLineLabel(line),
            description: route.description || '',
            modelFamily: targetModel.routeFamily,
            line,
            transport: route.transport,
            mode: route.mode,
            baseUrl: route.baseUrl,
            generatePath: route.generatePath,
            taskPath: route.taskPath || '',
            editPath: route.editPath || '',
            chatPath: route.chatPath || '',
            upstreamModel: route.upstreamModel || '',
            useRequestModel: route.useRequestModel === true,
            allowUserApiKeyWithoutLogin: route.allowUserApiKeyWithoutLogin === true,
            apiKeyEnv: route.apiKeyEnv || '',
            apiKey: '',
            pointCost: roundNonNegativePoint(route.pointCost || 0, 0),
            sortOrder: baseOrder + (index + 1) * 10,
            isActive: route.isActive !== false,
            isDefaultRoute: copyRoutesState.overwrite ? route.isDefaultRoute === true : false,
            isDefaultNanoBananaLine: copyRoutesState.overwrite ? route.isDefaultNanoBananaLine === true : false,
          });
        }
        if (hiddenKeys) toast.info('已复制线路结构；若原线路使用了直接保存 API Key，请在目标线路里重新填写。');
      } else {
        const sourceModel = videoModels.find((item) => item.id === copyRoutesState.sourceModelId);
        const targetModel = videoModels.find((item) => item.id === copyRoutesState.targetModelId);
        if (!sourceModel || !targetModel) throw new Error('视频模型不存在。');
        const sourceRoutes = getVideoRoutesForModel(sourceModel);
        const targetRoutes = getVideoRoutesForModel(targetModel);
        if (!sourceRoutes.length) throw new Error('源模型下没有可复制的线路。');
        if (copyRoutesState.overwrite) await Promise.all(targetRoutes.map((route) => deleteAdminVideoRoute(route.id)));
        const usedIds = new Set(videoRoutes.filter((route) => copyRoutesState.overwrite || route.routeFamily !== targetModel.routeFamily || !targetRoutes.some((target) => target.id === route.id)).map((route) => route.id));
        const usedLines = copyRoutesState.overwrite ? [] : targetRoutes.map((route) => route.line);
        const hiddenKeys = sourceRoutes.some((route) => route.hasApiKey);
        const baseOrder = copyRoutesState.overwrite ? 0 : Math.max(0, ...targetRoutes.map((route) => Number(route.sortOrder || 0)));
        for (const [index, route] of sourceRoutes.entries()) {
          const line = copyRoutesState.overwrite || !usedLines.includes(route.line) ? route.line : getNextLineValue(usedLines);
          usedLines.push(line);
          await createAdminVideoRoute({
            id: uniqueValue(`${targetModel.id}-${line}`, usedIds),
            label: route.label || buildLineLabel(line),
            description: route.description || '',
            routeFamily: targetModel.routeFamily,
            line,
            transport: 'openai-video',
            mode: 'async',
            baseUrl: route.baseUrl,
            generatePath: route.generatePath,
            taskPath: route.taskPath || '',
            upstreamModel: route.upstreamModel || '',
            useRequestModel: route.useRequestModel === true,
            allowUserApiKeyWithoutLogin: route.allowUserApiKeyWithoutLogin === true,
            apiKeyEnv: route.apiKeyEnv || '',
            apiKey: '',
            pointCost: roundNonNegativePoint(route.pointCost || 0, 0),
            sortOrder: baseOrder + (index + 1) * 10,
            isActive: route.isActive !== false,
            isDefaultRoute: copyRoutesState.overwrite ? route.isDefaultRoute === true : false,
          });
        }
        if (hiddenKeys) toast.info('已复制线路结构；若原线路使用了直接保存 API Key，请在目标线路里重新填写。');
      }
      toast.success('整组线路已复制。');
      setCopyRoutesState(null);
      await refreshAll();
    } catch (err) {
      toast.error((err as Error).message || '复制线路失败');
    } finally { setSaving(false); }
  }, [copyRoutesState, getImageRoutesForModel, getVideoRoutesForModel, imageModels, imageRoutes, refreshAll, toast, videoModels, videoRoutes]);

  const reorderImageModels = useCallback(
    async (dragId: string, targetId: string) => {
      if (dragId === targetId) return;
      const ordered = sortByOrder(imageModels);
      const fromIndex = ordered.findIndex((item) => item.id === dragId);
      const toIndex = ordered.findIndex((item) => item.id === targetId);
      if (fromIndex < 0 || toIndex < 0) return;
      const reordered = moveArrayItem(ordered, fromIndex, toIndex).map((item, index) => ({
        ...item,
        sortOrder: (index + 1) * 10,
      }));
      setImageModels(reordered);
      setSaving(true);
      try {
        await Promise.all(
          reordered.map((item, index) =>
            updateAdminImageModel(item.id, { sortOrder: (index + 1) * 10 }),
          ),
        );
        toast.success('图片模型排序已更新。');
        onRefreshDashboard?.();
      } catch (err) {
        toast.error((err as Error).message || '图片模型排序保存失败');
        await loadCatalog();
      } finally {
        setSaving(false);
        setDragState(null);
      }
    },
    [imageModels, loadCatalog, onRefreshDashboard, toast],
  );

  const reorderVideoModels = useCallback(
    async (dragId: string, targetId: string) => {
      if (dragId === targetId) return;
      const ordered = sortByOrder(videoModels);
      const fromIndex = ordered.findIndex((item) => item.id === dragId);
      const toIndex = ordered.findIndex((item) => item.id === targetId);
      if (fromIndex < 0 || toIndex < 0) return;
      const reordered = moveArrayItem(ordered, fromIndex, toIndex).map((item, index) => ({
        ...item,
        sortOrder: (index + 1) * 10,
      }));
      setVideoModels(reordered);
      setSaving(true);
      try {
        await Promise.all(
          reordered.map((item, index) =>
            updateAdminVideoModel(item.id, { sortOrder: (index + 1) * 10 }),
          ),
        );
        toast.success('视频模型排序已更新。');
        onRefreshDashboard?.();
      } catch (err) {
        toast.error((err as Error).message || '视频模型排序保存失败');
        await loadCatalog();
      } finally {
        setSaving(false);
        setDragState(null);
      }
    },
    [loadCatalog, onRefreshDashboard, toast, videoModels],
  );

  const reorderImageRoutes = useCallback(
    async (family: string, dragId: string, targetId: string) => {
      if (dragId === targetId) return;
      const familyRoutes = sortByOrder(imageRoutes.filter((route) => route.modelFamily === family));
      const fromIndex = familyRoutes.findIndex((item) => item.id === dragId);
      const toIndex = familyRoutes.findIndex((item) => item.id === targetId);
      if (fromIndex < 0 || toIndex < 0) return;
      const reorderedFamily = moveArrayItem(familyRoutes, fromIndex, toIndex).map((item, index) => ({
        ...item,
        sortOrder: (index + 1) * 10,
      }));
      const orderMap = new Map(reorderedFamily.map((item) => [item.id, item.sortOrder]));
      setImageRoutes((prev) =>
        sortByOrder(
          prev.map((route) =>
            orderMap.has(route.id) ? { ...route, sortOrder: orderMap.get(route.id)! } : route,
          ),
        ),
      );
      setSaving(true);
      try {
        await Promise.all(
          reorderedFamily.map((item, index) =>
            updateAdminImageRoute(item.id, { sortOrder: (index + 1) * 10 }),
          ),
        );
        toast.success('图片线路排序已更新。');
        onRefreshDashboard?.();
      } catch (err) {
        toast.error((err as Error).message || '图片线路排序保存失败');
        await loadCatalog();
      } finally {
        setSaving(false);
        setDragState(null);
      }
    },
    [imageRoutes, loadCatalog, onRefreshDashboard, toast],
  );

  const reorderVideoRoutes = useCallback(
    async (family: string, dragId: string, targetId: string) => {
      if (dragId === targetId) return;
      const familyRoutes = sortByOrder(videoRoutes.filter((route) => route.routeFamily === family));
      const fromIndex = familyRoutes.findIndex((item) => item.id === dragId);
      const toIndex = familyRoutes.findIndex((item) => item.id === targetId);
      if (fromIndex < 0 || toIndex < 0) return;
      const reorderedFamily = moveArrayItem(familyRoutes, fromIndex, toIndex).map((item, index) => ({
        ...item,
        sortOrder: (index + 1) * 10,
      }));
      const orderMap = new Map(reorderedFamily.map((item) => [item.id, item.sortOrder]));
      setVideoRoutes((prev) =>
        sortByOrder(
          prev.map((route) =>
            orderMap.has(route.id) ? { ...route, sortOrder: orderMap.get(route.id)! } : route,
          ),
        ),
      );
      setSaving(true);
      try {
        await Promise.all(
          reorderedFamily.map((item, index) =>
            updateAdminVideoRoute(item.id, { sortOrder: (index + 1) * 10 }),
          ),
        );
        toast.success('视频线路排序已更新。');
        onRefreshDashboard?.();
      } catch (err) {
        toast.error((err as Error).message || '视频线路排序保存失败');
        await loadCatalog();
      } finally {
        setSaving(false);
        setDragState(null);
      }
    },
    [loadCatalog, onRefreshDashboard, toast, videoRoutes],
  );

  const handleDrop = useCallback(
    async (target: Exclude<DragState, null>) => {
      if (!dragState || q) return;
      if (dragState.kind !== target.kind) return;
      if ((dragState.family || '') !== (target.family || '')) return;
      if (dragState.id === target.id) {
        setDragState(null);
        return;
      }
      if (target.kind === 'image-model') return reorderImageModels(dragState.id, target.id);
      if (target.kind === 'video-model') return reorderVideoModels(dragState.id, target.id);
      if (target.kind === 'image-route' && target.family) {
        return reorderImageRoutes(target.family, dragState.id, target.id);
      }
      if (target.kind === 'video-route' && target.family) {
        return reorderVideoRoutes(target.family, dragState.id, target.id);
      }
    },
    [dragState, q, reorderImageModels, reorderImageRoutes, reorderVideoModels, reorderVideoRoutes],
  );

  const renderModelStats = (stat?: AdminDashboardModelStat) => !stat ? <SectionPill className="border-white/10 bg-white/5 text-gray-300">最近请求 暂无数据</SectionPill> : <><SectionPill className="border-cyan-500/20 bg-cyan-500/15 text-cyan-100">24h {stat.requestsLast24h || 0} 次</SectionPill><SectionPill className={statTone(stat.successRateLast24h)}>24h 成功率 {formatRate(stat.successRateLast24h)}</SectionPill><SectionPill className="border-white/10 bg-white/5 text-gray-300">最近请求 {formatTime(stat.lastChargeAt)}</SectionPill></>;
  const renderRouteStats = (stat?: AdminDashboardRouteStat) => !stat ? <SectionPill className="border-white/10 bg-white/5 text-gray-300">最近请求 暂无数据</SectionPill> : <><SectionPill className="border-cyan-500/20 bg-cyan-500/15 text-cyan-100">24h {stat.requestsLast24h || 0} 次</SectionPill><SectionPill className={statTone(stat.successRateLast24h)}>24h 成功率 {formatRate(stat.successRateLast24h)}</SectionPill><SectionPill className={statTone(stat.successRate)}>总成功率 {formatRate(stat.successRate)}</SectionPill></>;
  const dragSortingEnabled = !q.trim();
  const getDragCardClass = useCallback(
    (baseClass: string, target: Exclude<DragState, null>) =>
      [
        `relative ${baseClass}`,
        'transition',
        dragState?.kind === target.kind && dragState.id === target.id ? 'ring-2 ring-cyan-400/60 opacity-80' : '',
        dropIndicator?.kind === target.kind && dropIndicator.id === target.id ? 'border-cyan-400/50 bg-cyan-500/[0.06]' : '',
      ]
        .filter(Boolean)
        .join(' '),
    [dragState, dropIndicator],
  );
  const getDragHandleClass = useCallback(
    (target: Exclude<DragState, null>) =>
      [
        'inline-flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white transition',
        dragSortingEnabled ? 'cursor-grab active:cursor-grabbing hover:border-cyan-400/40 hover:text-cyan-100' : 'cursor-not-allowed opacity-40',
        dragState?.kind === target.kind && dragState.id === target.id ? 'border-cyan-400/60 bg-cyan-500/10 text-cyan-100' : '',
      ]
        .filter(Boolean)
        .join(' '),
    [dragSortingEnabled, dragState],
  );
  const getDragCardProps = useCallback(
    (target: Exclude<DragState, null>) => {
      if (!dragSortingEnabled) {
        return { draggable: false } as const;
      }
      return {
        draggable: true,
        onDragStart: () => {
          setDragState(target);
          setDropIndicator(null);
        },
        onDragEnd: () => {
          setDragState(null);
          setDropIndicator(null);
        },
        onDragOver: (event: React.DragEvent<HTMLElement>) => {
          if (!dragState || dragState.kind !== target.kind) return;
          event.preventDefault();
        },
        onDrop: (event: React.DragEvent<HTMLElement>) => {
          event.preventDefault();
          setDropIndicator(null);
          void handleDrop(target);
        },
      } as const;
    },
    [dragSortingEnabled, dragState, handleDrop],
  );
  const getDropZoneProps = useCallback(
    (target: Exclude<DragState, null>) => {
      if (!dragSortingEnabled) {
        return {} as const;
      }
      return {
        onDragOver: (event: React.DragEvent<HTMLElement>) => {
          if (!dragState || dragState.kind !== target.kind) return;
          event.preventDefault();
          if (dragState.id !== target.id || (dragState.family || '') !== (target.family || '')) {
            setDropIndicator(target);
          }
        },
        onDrop: (event: React.DragEvent<HTMLElement>) => {
          event.preventDefault();
          setDropIndicator(null);
          void handleDrop(target);
        },
        onDragLeave: () => {
          if (dropIndicator?.kind === target.kind && dropIndicator.id === target.id) {
            setDropIndicator(null);
          }
        },
      } as const;
    },
    [dragSortingEnabled, dragState, dropIndicator, handleDrop],
  );
  const isDropIndicatorActive = useCallback(
    (target: Exclude<DragState, null>) =>
      dropIndicator?.kind === target.kind &&
      dropIndicator.id === target.id &&
      (dropIndicator.family || '') === (target.family || '') &&
      (!dragState || dragState.id !== target.id),
    [dragState, dropIndicator],
  );

  const renderImageRouteEditor = useCallback(() => {
    if (editor?.kind !== 'image-route') {
      return null;
    }

    return (
      <div className="mt-5 space-y-4">
        <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 p-4 text-sm text-cyan-50">
          <div className="mb-3 flex flex-wrap gap-2">
            <ActionButton onClick={() => setImageRouteForm((prev) => applyImageRoutePreset(prev, 'openai'))} tone="primary">OpenAI 图片异步模板</ActionButton>
            <ActionButton onClick={() => setImageRouteForm((prev) => applyImageRoutePreset(prev, 'gemini'))} tone="success">Gemini 同步模板</ActionButton>
          </div>
          <div className="space-y-2 text-xs leading-5 text-cyan-100/85">
            <p>OpenAI 图片异步：`openai-image + async + /v1/images/generations?async=true + taskPath`。</p>
            <p>Gemini 同步：`gemini-native + sync + /v1beta/models/{'{model}'}:generateContent`。</p>
            <p>默认 `upstreamModel` 和默认点数会作为兜底；如果填写 1K / 2K / 4K 覆写，则这些尺寸会优先走各自的模型和点数。</p>
            <p>如果你想兼容旧用户 Key，只建议给 OpenAI 异步线路打开“允许用户 API Key 免登录”。</p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2"><Input value={imageRouteForm.id} onChange={(e) => setImageRouteForm((prev) => ({ ...prev, id: e.target.value }))} placeholder="route id" /></div>
          <div className="sm:col-span-2"><Input value={imageRouteForm.label} onChange={(e) => setImageRouteForm((prev) => ({ ...prev, label: e.target.value }))} placeholder="显示名称" /></div>
          <div className="sm:col-span-2"><Textarea value={imageRouteForm.description || ''} onChange={(e) => setImageRouteForm((prev) => ({ ...prev, description: e.target.value }))} placeholder="线路说明" /></div>
          <Input value={imageRouteForm.modelFamily} onChange={(e) => setImageRouteForm((prev) => ({ ...prev, modelFamily: e.target.value }))} placeholder="线路族（routeFamily）" />
          <Input value={imageRouteForm.line} onChange={(e) => setImageRouteForm((prev) => ({ ...prev, line: e.target.value }))} placeholder="line1 / line2" />
          <Select value={imageRouteForm.transport} onChange={(e) => setImageRouteForm((prev) => ({ ...prev, transport: e.target.value as AdminImageRoutePayload['transport'] }))}><option value="openai-image">openai-image</option><option value="gemini-native">gemini-native</option></Select>
          <Select value={imageRouteForm.mode} onChange={(e) => setImageRouteForm((prev) => ({ ...prev, mode: e.target.value as AdminImageRoutePayload['mode'] }))}><option value="async">async</option><option value="sync">sync</option></Select>
          <Input value={imageRouteForm.baseUrl} onChange={(e) => setImageRouteForm((prev) => ({ ...prev, baseUrl: e.target.value }))} placeholder="baseUrl" />
          <Input type="number" step="0.1" min="0" value={String(imageRouteForm.pointCost || 0)} onChange={(e) => setImageRouteForm((prev) => ({ ...prev, pointCost: roundNonNegativePoint(e.target.value, 0) }))} placeholder="默认点数" />
          <div className="sm:col-span-2"><Input value={imageRouteForm.generatePath} onChange={(e) => setImageRouteForm((prev) => ({ ...prev, generatePath: e.target.value }))} placeholder="generatePath" /></div>
          <div className="sm:col-span-2"><Input value={imageRouteForm.taskPath || ''} onChange={(e) => setImageRouteForm((prev) => ({ ...prev, taskPath: e.target.value }))} placeholder="taskPath" /></div>
          <div className="sm:col-span-2"><Input value={imageRouteForm.editPath || ''} onChange={(e) => setImageRouteForm((prev) => ({ ...prev, editPath: e.target.value }))} placeholder="editPath" /></div>
          <div className="sm:col-span-2"><Input value={imageRouteForm.chatPath || ''} onChange={(e) => setImageRouteForm((prev) => ({ ...prev, chatPath: e.target.value }))} placeholder="chatPath" /></div>
          <div className="sm:col-span-2"><Input value={imageRouteForm.upstreamModel || ''} onChange={(e) => setImageRouteForm((prev) => ({ ...prev, upstreamModel: e.target.value }))} placeholder="默认 upstreamModel（未匹配到尺寸覆写时使用）" /></div>
        </div>

        <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4">
          <div className="mb-3">
            <div className="text-sm font-medium text-emerald-50">按尺寸映射（可选）</div>
            <HelpText>
              这里就是按尺寸单独映射：`1K -&gt; 模型 / 点数`、`2K -&gt; 模型 / 点数`、`4K -&gt; 模型 / 点数`。留空时会回退到上面的默认 `upstreamModel` 和默认点数。
            </HelpText>
          </div>
          <div className="space-y-3">
            {([
              { key: '1k', label: '1K', modelField: 'size1kUpstreamModel', costField: 'size1kPointCost' },
              { key: '2k', label: '2K', modelField: 'size2kUpstreamModel', costField: 'size2kPointCost' },
              { key: '4k', label: '4K', modelField: 'size4kUpstreamModel', costField: 'size4kPointCost' },
            ] as const).map((item) => (
              <div key={item.key} className="rounded-2xl border border-white/10 bg-black/10 p-3">
                <div className="mb-3 flex items-center gap-2 text-sm font-medium text-emerald-100">
                  <SectionPill className="justify-center border-emerald-400/30 bg-emerald-400/10 text-emerald-100">{item.label}</SectionPill>
                  <span className="text-emerald-50/80">{item.label} -&gt; 模型 / 点数</span>
                </div>
                <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_140px]">
                  <div>
                    <div className="mb-1 text-xs text-emerald-50/70">调用模型</div>
                    <Input value={String(imageRouteForm[item.modelField] || '')} onChange={(e) => setImageRouteForm((prev) => ({ ...prev, [item.modelField]: e.target.value }))} placeholder={`${item.label} 调用模型，例如 nano-banana-pro-${item.key === '1k' ? '' : item.key}`.replace(/-$/, '')} />
                  </div>
                  <div>
                    <div className="mb-1 text-xs text-emerald-50/70">消耗点数</div>
                    <Input type="number" step="0.1" min="0" value={String(roundNonNegativePoint(imageRouteForm[item.costField] || 0, 0))} onChange={(e) => setImageRouteForm((prev) => ({ ...prev, [item.costField]: roundNonNegativePoint(e.target.value, 0) }))} placeholder={`${item.label} 消耗点数`} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Input value={imageRouteForm.apiKeyEnv || ''} onChange={(e) => setImageRouteForm((prev) => ({ ...prev, apiKeyEnv: e.target.value }))} placeholder="apiKeyEnv" />
            <HelpText>线上推荐填写环境变量名；本地临时测试可直接在下面输入 API Key。</HelpText>
          </div>
          <div className="sm:col-span-2"><Input value={imageRouteForm.apiKey || ''} onChange={(e) => setImageRouteForm((prev) => ({ ...prev, apiKey: e.target.value }))} placeholder="直接保存 API Key（可选）" /></div>
          <Input type="number" value={String(imageRouteForm.sortOrder || 0)} onChange={(e) => setImageRouteForm((prev) => ({ ...prev, sortOrder: Number(e.target.value || 0) }))} placeholder="sortOrder" />
          <div />
          <div className="sm:col-span-2 grid gap-2 sm:grid-cols-2">
            <Toggle checked={imageRouteForm.useRequestModel === true} onChange={(checked) => setImageRouteForm((prev) => ({ ...prev, useRequestModel: checked }))} label="使用模型请求名" />
            <Toggle checked={imageRouteForm.isActive !== false} onChange={(checked) => setImageRouteForm((prev) => ({ ...prev, isActive: checked }))} label="启用" />
            <Toggle checked={imageRouteForm.allowUserApiKeyWithoutLogin === true} onChange={(checked) => setImageRouteForm((prev) => ({ ...prev, allowUserApiKeyWithoutLogin: checked }))} label="允许用户 API Key 免登录" />
            <Toggle checked={imageRouteForm.isDefaultRoute === true} onChange={(checked) => setImageRouteForm((prev) => ({ ...prev, isDefaultRoute: checked }))} label="本线路族默认线" />
            <Toggle checked={imageRouteForm.isDefaultNanoBananaLine === true} onChange={(checked) => setImageRouteForm((prev) => ({ ...prev, isDefaultNanoBananaLine: checked }))} label="Nano 默认线" />
          </div>
        </div>
      </div>
    );
  }, [editor?.kind, imageRouteForm]);

  if (!isSuperAdmin) {
    return <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-6 text-white"><h3 className="text-lg font-semibold">模型与线路管理</h3><p className="mt-2 text-sm text-gray-400">只有超级管理员可以维护模型、线路和高级批量操作。</p></div>;
  }

  return (
    <div className="space-y-5 text-white">
      <div className="rounded-3xl border border-white/10 bg-[#071221]/85 p-5 shadow-[0_16px_60px_rgba(0,0,0,0.28)]">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-2">
            <div className="flex items-center gap-2"><Boxes size={18} className="text-cyan-300" /><h2 className="text-lg font-semibold">模型与线路管理</h2></div>
            <p className="text-sm text-gray-400">超级管理员可在这里维护图片/视频模型、线路模板，以及批量启停、批量删除、整组复制线路。</p>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative min-w-[260px]"><Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" /><Input value={searchInput} onChange={(e) => setSearchInput(e.target.value)} placeholder="搜索模型、线路、域名或说明" className="pl-9" /></div>
            <ActionButton onClick={() => void refreshAll()} icon={<RefreshCw size={16} />} disabled={loading || saving}>刷新</ActionButton>
          </div>
        </div>
        {error ? <div className="mt-4 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">{error}</div> : null}
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-5">
          <section className="rounded-3xl border border-white/10 bg-[#071221]/85 p-5 shadow-[0_16px_60px_rgba(0,0,0,0.28)]">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <button type="button" onClick={() => toggleSectionCollapse('image')} className="mt-1 inline-flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white">{collapsedSections.image ? <ChevronRight size={16} /> : <ChevronDown size={16} />}</button>
                <div><div className="flex items-center gap-2"><Boxes size={18} className="text-cyan-300" /><h3 className="text-lg font-semibold">图片模型</h3></div><p className="mt-1 text-sm text-gray-400">一个模型下可以管理自己的一组图片线路，并支持批量启停、删除和整组复制。</p></div>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <ActionButton onClick={openCreateImageModel} icon={<Plus size={16} />} tone="primary">新增模型</ActionButton>
                <ActionButton onClick={() => selectVisibleItems('image', 'models')}>全选模型</ActionButton>
                <ActionButton onClick={() => selectVisibleItems('image', 'routes')}>全选线路</ActionButton>
                <ActionButton onClick={() => void bulkToggle('image', true)} icon={<Power size={16} />} tone="success">启用选中</ActionButton>
                <ActionButton onClick={() => void bulkToggle('image', false)} icon={<PowerOff size={16} />} tone="warning">停用选中</ActionButton>
                <ActionButton onClick={() => void bulkDelete('image')} icon={<Trash2 size={16} />} tone="danger">删除选中</ActionButton>
              </div>
            </div>
            {!collapsedSections.image ? (
              <div className="mt-5 space-y-4">
                <div className="flex flex-wrap gap-2">
                  <SectionPill className="border-white/10 bg-white/5 text-gray-300">
                    {dragSortingEnabled ? '已开启拖拽排序' : '清空搜索后可拖拽排序'}
                  </SectionPill>
                </div>
                {filteredImageModels.length ? filteredImageModels.map((model) => {
                  const routes = getImageRoutesForModel(model);
                  const modelStat = imageModelStats.get(model.id) || imageModelStats.get(model.id || model.modelFamily);
                  const collapsed = collapsedModels[model.id] === true;
                  const modelDragTarget = { kind: 'image-model', id: model.id } as const;
                  return (
                    <div
                      key={model.id}
                      {...getDropZoneProps(modelDragTarget)}
                      className={getDragCardClass('rounded-3xl border border-white/10 bg-black/20 p-4', modelDragTarget)}
                    >
                      {isDropIndicatorActive(modelDragTarget) ? (
                        <div className="pointer-events-none absolute left-4 right-4 top-0 h-1 rounded-full bg-cyan-300 shadow-[0_0_20px_rgba(34,211,238,0.75)]" />
                      ) : null}
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="flex items-start gap-3">
                          <button
                            type="button"
                            {...getDragCardProps(modelDragTarget)}
                            className={getDragHandleClass(modelDragTarget)}
                            aria-label={`拖拽排序 ${model.label}`}
                            title={dragSortingEnabled ? '拖拽排序' : '清空搜索后可拖拽排序'}
                          >
                            <GripVertical size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleModelCollapse(model.id)}
                            className="mt-1 inline-flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-white/5"
                          >
                            {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                          </button>
                          <input
                            type="checkbox"
                            checked={selection.imageModels.includes(model.id)}
                            onChange={(e) => setItemSelected('imageModels', model.id, e.target.checked)}
                            className="mt-3"
                          />
                          <div className="space-y-2">
                            <div>
                              <h4 className="text-lg font-semibold">{model.label}</h4>
                              <p className="text-sm text-cyan-200/80">{model.id} / {model.routeFamily}</p>
                            </div>
                            {model.description ? <p className="max-w-3xl text-sm text-gray-300">{model.description}</p> : null}
                            <div className="flex flex-wrap gap-2">
                              {renderModelStats(modelStat)}
                              {model.isDefaultModel ? <SectionPill className="border-amber-500/30 bg-amber-500/15 text-amber-100">默认模型</SectionPill> : null}
                              {!model.isActive ? <SectionPill className="border-rose-500/30 bg-rose-500/15 text-rose-100">已停用</SectionPill> : null}
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2 lg:max-w-[420px] lg:justify-end">
                          <ActionButton onClick={() => openEditImageModel(model)} icon={<Pencil size={16} />}>编辑模型</ActionButton>
                          <ActionButton onClick={() => openCreateImageRoute(model)} icon={<Plus size={16} />} tone="primary">新增线路</ActionButton>
                          <ActionButton onClick={() => openCopyRoutes('image', model.id)} icon={<Copy size={16} />}>复制整组线路</ActionButton>
                          <ActionButton onClick={() => void deleteImageModelWithRoutes(model.id)} icon={<Trash2 size={16} />} tone="danger">删除模型</ActionButton>
                        </div>
                      </div>
                      {!collapsed ? (
                        <div className="mt-4 space-y-3">
                          {routes.length ? routes.map((route) => {
                            const routeStat = imageRouteStats.get(route.id);
                            const routeDragTarget = { kind: 'image-route', id: route.id, family: model.routeFamily } as const;
                            return (
                              <div
                                key={route.id}
                                {...getDropZoneProps(routeDragTarget)}
                                className={getDragCardClass('flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 lg:flex-row lg:items-start lg:justify-between', routeDragTarget)}
                              >
                                {isDropIndicatorActive(routeDragTarget) ? (
                                  <div className="pointer-events-none absolute left-4 right-4 top-0 h-1 rounded-full bg-cyan-300 shadow-[0_0_18px_rgba(34,211,238,0.75)]" />
                                ) : null}
                                <div className="flex items-start gap-3">
                                  <button
                                    type="button"
                                    {...getDragCardProps(routeDragTarget)}
                                    className={getDragHandleClass(routeDragTarget)}
                                    aria-label={`拖拽排序 ${route.label}`}
                                    title={dragSortingEnabled ? '拖拽排序' : '清空搜索后可拖拽排序'}
                                  >
                                    <GripVertical size={16} />
                                  </button>
                                  <input
                                    type="checkbox"
                                    checked={selection.imageRoutes.includes(route.id)}
                                    onChange={(e) => setItemSelected('imageRoutes', route.id, e.target.checked)}
                                    className="mt-1.5"
                                  />
                                  <div className="space-y-2">
                                    <div>
                                      <h5 className="font-semibold">{route.label}</h5>
                                      <p className="text-sm text-gray-400">{route.line} / {route.transport} / {route.mode}</p>
                                    </div>
                                    {route.description ? <p className="text-sm text-gray-300">{route.description}</p> : null}
                                    <div className="flex flex-wrap gap-2">
                                      <SectionPill className="border-white/10 bg-white/5 text-gray-200">{formatPoint(route.pointCost || 0)} 点/次</SectionPill>
                                      {route.allowUserApiKeyWithoutLogin ? <SectionPill className="border-cyan-500/20 bg-cyan-500/15 text-cyan-100">兼容旧用户 Key</SectionPill> : null}
                                      {route.isDefaultRoute ? <SectionPill className="border-amber-500/30 bg-amber-500/15 text-amber-100">本线路族默认线</SectionPill> : null}
                                      {route.isDefaultNanoBananaLine ? <SectionPill className="border-amber-500/30 bg-amber-500/15 text-amber-100">Nano 默认线</SectionPill> : null}
                                      {!route.isActive ? <SectionPill className="border-rose-500/30 bg-rose-500/15 text-rose-100">已停用</SectionPill> : null}
                                      {renderRouteStats(routeStat)}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex flex-wrap gap-2 lg:justify-end">
                                  <ActionButton onClick={() => openEditImageRoute(route)} icon={<Pencil size={16} />}>编辑</ActionButton>
                                  <ActionButton onClick={() => void deleteImageRouteWithConfirm(route.id)} icon={<Trash2 size={16} />} tone="danger">删除</ActionButton>
                                </div>
                              </div>
                            );
                          }) : (
                            <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-6 text-sm text-gray-400">
                              当前模型还没有图片线路，点击“新增线路”即可开始配置。
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                }) : (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-6 text-sm text-gray-400">
                    {q ? '没有匹配的图片模型或线路。' : '还没有图片模型，先创建一个模型。'}
                  </div>
                )}
              </div>
            ) : null}
          </section>
          <section className="rounded-3xl border border-white/10 bg-[#071221]/85 p-5 shadow-[0_16px_60px_rgba(0,0,0,0.28)]">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <button type="button" onClick={() => toggleSectionCollapse('video')} className="mt-1 inline-flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white">{collapsedSections.video ? <ChevronRight size={16} /> : <ChevronDown size={16} />}</button>
                <div><div className="flex items-center gap-2"><Clapperboard size={18} className="text-fuchsia-300" /><h3 className="text-lg font-semibold">视频模型</h3></div><p className="mt-1 text-sm text-gray-400">视频线路同样支持批量启停、批量删除和整组复制，便于快速复用配置。</p><div className="mt-2 flex flex-wrap gap-2"><SectionPill className="border-white/10 bg-white/5 text-gray-300">{dragSortingEnabled ? '已开启拖拽排序' : '清空搜索后可拖拽排序'}</SectionPill></div></div>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <ActionButton onClick={openCreateVideoModel} icon={<Plus size={16} />} tone="primary">新增模型</ActionButton>
                <ActionButton onClick={() => selectVisibleItems('video', 'models')}>全选模型</ActionButton>
                <ActionButton onClick={() => selectVisibleItems('video', 'routes')}>全选线路</ActionButton>
                <ActionButton onClick={() => void bulkToggle('video', true)} icon={<Power size={16} />} tone="success">启用选中</ActionButton>
                <ActionButton onClick={() => void bulkToggle('video', false)} icon={<PowerOff size={16} />} tone="warning">停用选中</ActionButton>
                <ActionButton onClick={() => void bulkDelete('video')} icon={<Trash2 size={16} />} tone="danger">删除选中</ActionButton>
              </div>
            </div>
            {!collapsedSections.video ? (
              <div className="mt-5 space-y-4">
                {filteredVideoModels.length ? filteredVideoModels.map((model) => {
                  const routes = getVideoRoutesForModel(model);
                  const modelStat = videoModelStats.get(model.id) || videoModelStats.get(model.id || model.modelFamily);
                  const collapsed = collapsedModels[model.id] === true;
                  const modelDragTarget = { kind: 'video-model', id: model.id } as const;
                  return (
                    <div
                      key={model.id}
                      {...getDropZoneProps(modelDragTarget)}
                      className={getDragCardClass('rounded-3xl border border-white/10 bg-black/20 p-4', modelDragTarget)}
                    >
                      {isDropIndicatorActive(modelDragTarget) ? (
                        <div className="pointer-events-none absolute left-4 right-4 top-0 h-1 rounded-full bg-cyan-300 shadow-[0_0_20px_rgba(34,211,238,0.75)]" />
                      ) : null}
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="flex items-start gap-3">
                          <button
                            type="button"
                            {...getDragCardProps(modelDragTarget)}
                            className={getDragHandleClass(modelDragTarget)}
                            aria-label={`拖拽排序 ${model.label}`}
                            title={dragSortingEnabled ? '拖拽排序' : '清空搜索后可拖拽排序'}
                          >
                            <GripVertical size={16} />
                          </button>
                          <button
                            type="button"
                            onClick={() => toggleModelCollapse(model.id)}
                            className="mt-1 inline-flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-white/5"
                          >
                            {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                          </button>
                          <input
                            type="checkbox"
                            checked={selection.videoModels.includes(model.id)}
                            onChange={(e) => setItemSelected('videoModels', model.id, e.target.checked)}
                            className="mt-3"
                          />
                          <div className="space-y-2">
                            <div>
                              <h4 className="text-lg font-semibold">{model.label}</h4>
                              <p className="text-sm text-fuchsia-200/80">{model.id} / {model.routeFamily}</p>
                            </div>
                            {model.description ? <p className="max-w-3xl text-sm text-gray-300">{model.description}</p> : null}
                            <div className="flex flex-wrap gap-2">
                              {renderModelStats(modelStat)}
                              {model.isDefaultModel ? <SectionPill className="border-amber-500/30 bg-amber-500/15 text-amber-100">默认模型</SectionPill> : null}
                              {!model.isActive ? <SectionPill className="border-rose-500/30 bg-rose-500/15 text-rose-100">已停用</SectionPill> : null}
                            </div>
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-2 lg:max-w-[420px] lg:justify-end">
                          <ActionButton onClick={() => openEditVideoModel(model)} icon={<Pencil size={16} />}>编辑模型</ActionButton>
                          <ActionButton onClick={() => openCreateVideoRoute(model)} icon={<Plus size={16} />} tone="primary">新增线路</ActionButton>
                          <ActionButton onClick={() => openCopyRoutes('video', model.id)} icon={<Copy size={16} />}>复制整组线路</ActionButton>
                          <ActionButton onClick={() => void deleteVideoModelWithRoutes(model.id)} icon={<Trash2 size={16} />} tone="danger">删除模型</ActionButton>
                        </div>
                      </div>
                      {!collapsed ? (
                        <div className="mt-4 space-y-3">
                          {routes.length ? routes.map((route) => {
                            const routeStat = videoRouteStats.get(route.id);
                            const routeDragTarget = { kind: 'video-route', id: route.id, family: model.routeFamily } as const;
                            return (
                              <div
                                key={route.id}
                                {...getDropZoneProps(routeDragTarget)}
                                className={getDragCardClass('flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4 lg:flex-row lg:items-start lg:justify-between', routeDragTarget)}
                              >
                                {isDropIndicatorActive(routeDragTarget) ? (
                                  <div className="pointer-events-none absolute left-4 right-4 top-0 h-1 rounded-full bg-cyan-300 shadow-[0_0_18px_rgba(34,211,238,0.75)]" />
                                ) : null}
                                <div className="flex items-start gap-3">
                                  <button
                                    type="button"
                                    {...getDragCardProps(routeDragTarget)}
                                    className={getDragHandleClass(routeDragTarget)}
                                    aria-label={`拖拽排序 ${route.label}`}
                                    title={dragSortingEnabled ? '拖拽排序' : '清空搜索后可拖拽排序'}
                                  >
                                    <GripVertical size={16} />
                                  </button>
                                  <input
                                    type="checkbox"
                                    checked={selection.videoRoutes.includes(route.id)}
                                    onChange={(e) => setItemSelected('videoRoutes', route.id, e.target.checked)}
                                    className="mt-1.5"
                                  />
                                  <div className="space-y-2">
                                    <div>
                                      <h5 className="font-semibold">{route.label}</h5>
                                      <p className="text-sm text-gray-400">{route.line} / {route.transport} / {route.mode}</p>
                                    </div>
                                    {route.description ? <p className="text-sm text-gray-300">{route.description}</p> : null}
                                    <div className="flex flex-wrap gap-2">
                                      <SectionPill className="border-white/10 bg-white/5 text-gray-200">{formatPoint(route.pointCost || 0)} 点/次</SectionPill>
                                      {route.allowUserApiKeyWithoutLogin ? <SectionPill className="border-cyan-500/20 bg-cyan-500/15 text-cyan-100">兼容旧用户 Key</SectionPill> : null}
                                      {route.isDefaultRoute ? <SectionPill className="border-amber-500/30 bg-amber-500/15 text-amber-100">默认线路</SectionPill> : null}
                                      {!route.isActive ? <SectionPill className="border-rose-500/30 bg-rose-500/15 text-rose-100">已停用</SectionPill> : null}
                                      {renderRouteStats(routeStat)}
                                    </div>
                                  </div>
                                </div>
                                <div className="flex flex-wrap gap-2 lg:justify-end">
                                  <ActionButton onClick={() => openEditVideoRoute(route)} icon={<Pencil size={16} />}>编辑</ActionButton>
                                  <ActionButton onClick={() => void deleteVideoRouteWithConfirm(route.id)} icon={<Trash2 size={16} />} tone="danger">删除</ActionButton>
                                </div>
                              </div>
                            );
                          }) : (
                            <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-6 text-sm text-gray-400">
                              当前模型还没有视频线路，点击“新增线路”即可开始配置。
                            </div>
                          )}
                        </div>
                      ) : null}
                    </div>
                  );
                }) : (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-6 text-sm text-gray-400">
                    {q ? '没有匹配的视频模型或线路。' : '还没有视频模型，先创建一个模型。'}
                  </div>
                )}
              </div>
            ) : null}
          </section>
        </div>
        <aside className="rounded-3xl border border-white/10 bg-[#08131d]/90 p-5 shadow-[0_16px_60px_rgba(0,0,0,0.28)] xl:sticky xl:top-4 xl:h-fit">
          <div className="flex items-start justify-between gap-3"><div><h3 className="text-lg font-semibold">{editor ? editor.kind === 'image-model' ? editor.mode === 'create' ? '新建图片模型' : '编辑图片模型' : editor.kind === 'image-route' ? editor.mode === 'create' ? '新建图片线路' : '编辑图片线路' : editor.kind === 'video-model' ? editor.mode === 'create' ? '新建视频模型' : '编辑视频模型' : editor.mode === 'create' ? '新建视频线路' : '编辑视频线路' : '右侧编辑区'}</h3><p className="mt-1 text-sm text-gray-400">{editor ? '填好表单后点击保存，模型和线路会立即同步到前台 catalog。' : '从左侧选择一个模型或线路进行编辑，或直接新建。'}</p></div>{editor ? <button type="button" onClick={resetEditor} className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white"><X size={16} /></button> : null}</div>
          {!editor ? <div className="mt-5 space-y-4 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-4 text-sm text-gray-300"><p>当前这版已经支持：</p><ul className="list-disc space-y-2 pl-5 text-gray-400"><li>图片/视频模型与线路的新增、编辑、删除</li><li>批量启用、停用、删除选中项</li><li>复制某个模型下的整组线路到另一个模型</li><li>图片线路模板快速填充和保存前校验</li></ul></div> : null}
          {editor?.kind === 'image-model' ? <div className="mt-5 space-y-4"><div className="grid gap-3 sm:grid-cols-2"><div className="sm:col-span-2"><Input value={imageModelForm.id} onChange={(e) => setImageModelForm((prev) => ({ ...prev, id: e.target.value }))} placeholder="model id" /><HelpText>模型唯一 ID，例如 `nano-banana-pro`。</HelpText></div><div className="sm:col-span-2"><Input value={imageModelForm.label} onChange={(e) => setImageModelForm((prev) => ({ ...prev, label: e.target.value }))} placeholder="显示名称" /></div><div className="sm:col-span-2"><Textarea value={imageModelForm.description || ''} onChange={(e) => setImageModelForm((prev) => ({ ...prev, description: e.target.value }))} placeholder="模型说明" /></div><Input value={imageModelForm.modelFamily} onChange={(e) => setImageModelForm((prev) => ({ ...prev, modelFamily: e.target.value }))} placeholder="modelFamily" /><Input value={imageModelForm.routeFamily} onChange={(e) => setImageModelForm((prev) => ({ ...prev, routeFamily: e.target.value }))} placeholder="routeFamily" /><Input value={imageModelForm.requestModel || ''} onChange={(e) => setImageModelForm((prev) => ({ ...prev, requestModel: e.target.value }))} placeholder="requestModel" /><Input type="number" step="0.1" min="0" value={String(imageModelForm.selectorCost || 0)} onChange={(e) => setImageModelForm((prev) => ({ ...prev, selectorCost: roundNonNegativePoint(e.target.value, 0) }))} placeholder="selectorCost" /><Select value={imageModelForm.iconKind} onChange={(e) => setImageModelForm((prev) => ({ ...prev, iconKind: e.target.value as AdminImageModelPayload['iconKind'] }))}><option value="banana">banana</option><option value="banana-zap">banana-zap</option><option value="sparkles">sparkles</option><option value="layers">layers</option><option value="zap">zap</option><option value="none">none</option></Select><Select value={imageModelForm.panelLayout} onChange={(e) => setImageModelForm((prev) => ({ ...prev, panelLayout: e.target.value as AdminImageModelPayload['panelLayout'] }))}><option value="nano-banana">nano-banana</option><option value="default">default</option><option value="compact">compact</option></Select><Select value={imageModelForm.sizeBehavior} onChange={(e) => setImageModelForm((prev) => ({ ...prev, sizeBehavior: e.target.value as AdminImageModelPayload['sizeBehavior'] }))}><option value="passthrough">passthrough</option><option value="doubao-v5">doubao-v5</option><option value="doubao-v45">doubao-v45</option><option value="z-image-turbo">z-image-turbo</option></Select><Input value={imageModelForm.defaultSize || ''} onChange={(e) => setImageModelForm((prev) => ({ ...prev, defaultSize: e.target.value }))} placeholder="defaultSize" /><div className="sm:col-span-2"><Input value={imageModelForm.sizeOptionsInput} onChange={(e) => setImageModelForm((prev) => ({ ...prev, sizeOptionsInput: e.target.value }))} placeholder="sizeOptions，用逗号分隔" /></div><div className="sm:col-span-2"><Input value={imageModelForm.extraAspectRatiosInput} onChange={(e) => setImageModelForm((prev) => ({ ...prev, extraAspectRatiosInput: e.target.value }))} placeholder="额外比例，用逗号分隔" /></div><Input type="number" value={String(imageModelForm.sortOrder || 0)} onChange={(e) => setImageModelForm((prev) => ({ ...prev, sortOrder: Number(e.target.value || 0) }))} placeholder="sortOrder" /><div className="sm:col-span-2 grid gap-2 sm:grid-cols-2"><Toggle checked={imageModelForm.showSizeSelector !== false} onChange={(checked) => setImageModelForm((prev) => ({ ...prev, showSizeSelector: checked }))} label="显示尺寸选择器" /><Toggle checked={imageModelForm.supportsCustomRatio !== false} onChange={(checked) => setImageModelForm((prev) => ({ ...prev, supportsCustomRatio: checked }))} label="允许自定义比例" /><Toggle checked={imageModelForm.isActive !== false} onChange={(checked) => setImageModelForm((prev) => ({ ...prev, isActive: checked }))} label="启用" /><Toggle checked={imageModelForm.isDefaultModel === true} onChange={(checked) => setImageModelForm((prev) => ({ ...prev, isDefaultModel: checked }))} label="默认模型" /></div></div></div> : null}
          {renderImageRouteEditor()}
          {editor?.kind === 'video-model' ? <div className="mt-5 space-y-4"><div className="grid gap-3 sm:grid-cols-2"><div className="sm:col-span-2"><Input value={videoModelForm.id} onChange={(e) => setVideoModelForm((prev) => ({ ...prev, id: e.target.value }))} placeholder="model id" /></div><div className="sm:col-span-2"><Input value={videoModelForm.label} onChange={(e) => setVideoModelForm((prev) => ({ ...prev, label: e.target.value }))} placeholder="显示名称" /></div><div className="sm:col-span-2"><Textarea value={videoModelForm.description || ''} onChange={(e) => setVideoModelForm((prev) => ({ ...prev, description: e.target.value }))} placeholder="模型说明" /></div><Input value={videoModelForm.modelFamily} onChange={(e) => setVideoModelForm((prev) => ({ ...prev, modelFamily: e.target.value }))} placeholder="modelFamily" /><Input value={videoModelForm.routeFamily} onChange={(e) => setVideoModelForm((prev) => ({ ...prev, routeFamily: e.target.value }))} placeholder="routeFamily" /><Input value={videoModelForm.requestModel || ''} onChange={(e) => setVideoModelForm((prev) => ({ ...prev, requestModel: e.target.value }))} placeholder="requestModel" /><Input type="number" step="0.1" min="0" value={String(videoModelForm.selectorCost || 0)} onChange={(e) => setVideoModelForm((prev) => ({ ...prev, selectorCost: roundNonNegativePoint(e.target.value, 0) }))} placeholder="selectorCost" /><Input type="number" value={String(videoModelForm.maxReferenceImages || 1)} onChange={(e) => setVideoModelForm((prev) => ({ ...prev, maxReferenceImages: Number(e.target.value || 1) }))} placeholder="最大参考图" /><Input value={videoModelForm.defaultAspectRatio || ''} onChange={(e) => setVideoModelForm((prev) => ({ ...prev, defaultAspectRatio: e.target.value }))} placeholder="默认比例" /><Input value={videoModelForm.defaultDuration || ''} onChange={(e) => setVideoModelForm((prev) => ({ ...prev, defaultDuration: e.target.value }))} placeholder="默认时长" /><div className="sm:col-span-2"><Input value={videoModelForm.referenceLabelsInput} onChange={(e) => setVideoModelForm((prev) => ({ ...prev, referenceLabelsInput: e.target.value }))} placeholder="参考图标签，用逗号分隔" /></div><div className="sm:col-span-2"><Input value={videoModelForm.aspectRatioOptionsInput} onChange={(e) => setVideoModelForm((prev) => ({ ...prev, aspectRatioOptionsInput: e.target.value }))} placeholder="比例选项，用逗号分隔" /></div><div className="sm:col-span-2"><Input value={videoModelForm.durationOptionsInput} onChange={(e) => setVideoModelForm((prev) => ({ ...prev, durationOptionsInput: e.target.value }))} placeholder="时长选项，用逗号分隔" /></div><Input type="number" value={String(videoModelForm.sortOrder || 0)} onChange={(e) => setVideoModelForm((prev) => ({ ...prev, sortOrder: Number(e.target.value || 0) }))} placeholder="sortOrder" /><div className="sm:col-span-2 grid gap-2 sm:grid-cols-2"><Toggle checked={videoModelForm.supportsHd === true} onChange={(checked) => setVideoModelForm((prev) => ({ ...prev, supportsHd: checked }))} label="支持高清" /><Toggle checked={videoModelForm.defaultHd === true} onChange={(checked) => setVideoModelForm((prev) => ({ ...prev, defaultHd: checked }))} label="默认高清" /><Toggle checked={videoModelForm.isActive !== false} onChange={(checked) => setVideoModelForm((prev) => ({ ...prev, isActive: checked }))} label="启用" /><Toggle checked={videoModelForm.isDefaultModel === true} onChange={(checked) => setVideoModelForm((prev) => ({ ...prev, isDefaultModel: checked }))} label="默认模型" /></div></div></div> : null}
          {editor?.kind === 'video-route' ? <div className="mt-5 space-y-4"><div className="rounded-2xl border border-fuchsia-500/20 bg-fuchsia-500/10 p-4 text-sm text-fuchsia-50"><div className="space-y-2 text-xs leading-5 text-fuchsia-100/85"><p>视频线路当前统一使用 OpenAI 兼容异步接口。</p><p>建议至少填写 `generatePath`、`taskPath`、`upstreamModel`，然后再决定是否启用旧 Key 兼容。</p></div></div><div className="grid gap-3 sm:grid-cols-2"><div className="sm:col-span-2"><Input value={videoRouteForm.id} onChange={(e) => setVideoRouteForm((prev) => ({ ...prev, id: e.target.value }))} placeholder="route id" /></div><div className="sm:col-span-2"><Input value={videoRouteForm.label} onChange={(e) => setVideoRouteForm((prev) => ({ ...prev, label: e.target.value }))} placeholder="显示名称" /></div><div className="sm:col-span-2"><Textarea value={videoRouteForm.description || ''} onChange={(e) => setVideoRouteForm((prev) => ({ ...prev, description: e.target.value }))} placeholder="线路说明" /></div><Input value={videoRouteForm.routeFamily} onChange={(e) => setVideoRouteForm((prev) => ({ ...prev, routeFamily: e.target.value }))} placeholder="线路族（routeFamily）" /><Input value={videoRouteForm.line} onChange={(e) => setVideoRouteForm((prev) => ({ ...prev, line: e.target.value }))} placeholder="line1 / line2" /><Input value={videoRouteForm.baseUrl} onChange={(e) => setVideoRouteForm((prev) => ({ ...prev, baseUrl: e.target.value }))} placeholder="baseUrl" /><Input type="number" step="0.1" min="0" value={String(videoRouteForm.pointCost || 0)} onChange={(e) => setVideoRouteForm((prev) => ({ ...prev, pointCost: roundNonNegativePoint(e.target.value, 0) }))} placeholder="点数" /><div className="sm:col-span-2"><Input value={videoRouteForm.generatePath} onChange={(e) => setVideoRouteForm((prev) => ({ ...prev, generatePath: e.target.value }))} placeholder="generatePath" /></div><div className="sm:col-span-2"><Input value={videoRouteForm.taskPath || ''} onChange={(e) => setVideoRouteForm((prev) => ({ ...prev, taskPath: e.target.value }))} placeholder="taskPath" /></div><div className="sm:col-span-2"><Input value={videoRouteForm.upstreamModel || ''} onChange={(e) => setVideoRouteForm((prev) => ({ ...prev, upstreamModel: e.target.value }))} placeholder="upstreamModel" /></div><div className="sm:col-span-2"><Input value={videoRouteForm.apiKeyEnv || ''} onChange={(e) => setVideoRouteForm((prev) => ({ ...prev, apiKeyEnv: e.target.value }))} placeholder="apiKeyEnv" /></div><div className="sm:col-span-2"><Input value={videoRouteForm.apiKey || ''} onChange={(e) => setVideoRouteForm((prev) => ({ ...prev, apiKey: e.target.value }))} placeholder="直接保存 API Key（可选）" /></div><Input type="number" value={String(videoRouteForm.sortOrder || 0)} onChange={(e) => setVideoRouteForm((prev) => ({ ...prev, sortOrder: Number(e.target.value || 0) }))} placeholder="sortOrder" /><div className="sm:col-span-2 grid gap-2 sm:grid-cols-2"><Toggle checked={videoRouteForm.useRequestModel === true} onChange={(checked) => setVideoRouteForm((prev) => ({ ...prev, useRequestModel: checked }))} label="使用模型请求名" /><Toggle checked={videoRouteForm.allowUserApiKeyWithoutLogin === true} onChange={(checked) => setVideoRouteForm((prev) => ({ ...prev, allowUserApiKeyWithoutLogin: checked }))} label="允许用户 API Key 免登录" /><Toggle checked={videoRouteForm.isActive !== false} onChange={(checked) => setVideoRouteForm((prev) => ({ ...prev, isActive: checked }))} label="启用" /><Toggle checked={videoRouteForm.isDefaultRoute === true} onChange={(checked) => setVideoRouteForm((prev) => ({ ...prev, isDefaultRoute: checked }))} label="默认线路" /></div></div></div> : null}
          {editor ? <div className="mt-5 flex items-center justify-end gap-2"><ActionButton onClick={resetEditor}>取消</ActionButton><ActionButton onClick={() => void saveEditor()} icon={saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} tone="primary" disabled={saving}>保存</ActionButton></div> : null}
        </aside>
      </div>
      {copyRoutesState ? <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"><div className="w-full max-w-xl rounded-3xl border border-white/10 bg-[#091523] p-6 shadow-[0_20px_80px_rgba(0,0,0,0.45)]"><div className="flex items-start justify-between gap-3"><div><h3 className="text-lg font-semibold">复制整组线路</h3><p className="mt-1 text-sm text-gray-400">将当前模型下的所有 {copyRoutesState.media === 'image' ? '图片' : '视频'}线路复制到另一个模型。</p></div><button type="button" onClick={() => setCopyRoutesState(null)} className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-white"><X size={16} /></button></div><div className="mt-5 space-y-4"><div className="grid gap-3 sm:grid-cols-2"><div><label className="mb-2 block text-sm text-gray-300">源模型</label><div className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white">{copyRoutesState.media === 'image' ? imageModels.find((model) => model.id === copyRoutesState.sourceModelId)?.label : videoModels.find((model) => model.id === copyRoutesState.sourceModelId)?.label}</div></div><div><label className="mb-2 block text-sm text-gray-300">目标模型</label><Select value={copyRoutesState.targetModelId} onChange={(e) => setCopyRoutesState((prev) => prev ? { ...prev, targetModelId: e.target.value } : prev)}><option value="">请选择目标模型</option>{(copyRoutesState.media === 'image' ? filteredImageModels : filteredVideoModels).filter((model) => model.id !== copyRoutesState.sourceModelId).map((model) => <option key={model.id} value={model.id}>{model.label}</option>)}</Select></div></div><label className="flex items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm text-gray-200"><input type="checkbox" checked={copyRoutesState.overwrite} onChange={(e) => setCopyRoutesState((prev) => prev ? { ...prev, overwrite: e.target.checked } : prev)} />先清空目标模型下现有线路，再按源模型完整覆盖</label><div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">如果源线路是通过“直接保存 API Key”方式配置的，复制时不会带出真实密钥；复制完成后请到目标线路里重新填写。</div></div><div className="mt-5 flex items-center justify-end gap-2"><ActionButton onClick={() => setCopyRoutesState(null)}>取消</ActionButton><ActionButton onClick={() => void executeCopyRoutes()} icon={saving ? <Loader2 size={16} className="animate-spin" /> : <Copy size={16} />} tone="primary" disabled={saving}>开始复制</ActionButton></div></div></div> : null}
    </div>
  );
};

export default MediaCatalogAdminPanel;
