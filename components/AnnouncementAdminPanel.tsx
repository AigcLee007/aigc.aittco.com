import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  Loader2,
  Megaphone,
  Pin,
  PinOff,
  Power,
  PowerOff,
  RefreshCw,
  Save,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { AuthSessionPayload, getAuthorizedBillingHeaders } from '../src/services/accountIdentity';
import { useToast } from '../src/context/ToastContext';

interface AnnouncementAdminPanelProps {
  session: AuthSessionPayload | null;
}

interface AnnouncementItem {
  id: string;
  title: string;
  content: string;
  active: boolean;
  date: string;
  pinned?: boolean;
  images?: string[];
}

const AnnouncementAdminPanel: React.FC<AnnouncementAdminPanelProps> = ({ session }) => {
  const toast = useToast();
  const isAdmin = session?.user?.isAdmin === true;

  const [announcementForm, setAnnouncementForm] = useState({
    title: '',
    content: '',
    active: true,
    pinned: false,
  });
  const [isSavingAnnouncement, setIsSavingAnnouncement] = useState(false);
  const [announcementItems, setAnnouncementItems] = useState<AnnouncementItem[]>([]);
  const [isLoadingAnnouncements, setIsLoadingAnnouncements] = useState(false);
  const [deletingAnnouncementId, setDeletingAnnouncementId] = useState<string | null>(null);
  const [pinningAnnouncementId, setPinningAnnouncementId] = useState<string | null>(null);
  const [activatingAnnouncementId, setActivatingAnnouncementId] = useState<string | null>(null);
  const [announcementSearchInput, setAnnouncementSearchInput] = useState('');
  const [announcementSearchKeyword, setAnnouncementSearchKeyword] = useState('');
  const [announcementPage, setAnnouncementPage] = useState(1);
  const [announcementTotal, setAnnouncementTotal] = useState(0);
  const [announcementTotalPages, setAnnouncementTotalPages] = useState(1);
  const [announcementImageDataUrls, setAnnouncementImageDataUrls] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  const announcementImageInputRef = useRef<HTMLInputElement | null>(null);

  const fetchAnnouncements = useCallback(
    async ({
      page = 1,
      search = '',
    }: {
      page?: number;
      search?: string;
    } = {}) => {
      if (!isAdmin) return;

      try {
        setIsLoadingAnnouncements(true);
        setError(null);
        const headers = await getAuthorizedBillingHeaders();
        const qs = new URLSearchParams();
        qs.set('all', '1');
        qs.set('page', String(page));
        qs.set('pageSize', '8');
        if (search.trim()) qs.set('search', search.trim());
        const res = await fetch(`/api/announcements?${qs.toString()}`, { headers });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data?.error || '加载公告失败');
        }
        const items = Array.isArray(data?.items) ? data.items : [];
        setAnnouncementItems(items);
        setAnnouncementTotal(Number(data?.total || 0));
        setAnnouncementTotalPages(Math.max(1, Number(data?.totalPages || 1)));
        setAnnouncementPage(Math.max(1, Number(data?.page || 1)));
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setIsLoadingAnnouncements(false);
      }
    },
    [isAdmin],
  );

  useEffect(() => {
    if (!isAdmin) return;
    void fetchAnnouncements({ page: 1, search: '' });
  }, [fetchAnnouncements, isAdmin]);

  const readFileAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('读取图片失败'));
      reader.readAsDataURL(file);
    });

  const handleSelectAnnouncementImages = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    const remain = Math.max(0, 9 - announcementImageDataUrls.length);
    const picked = files.slice(0, remain);
    if (!picked.length) {
      setError('公告图片最多 9 张');
      event.target.value = '';
      return;
    }
    try {
      const urls = await Promise.all(picked.map(readFileAsDataUrl));
      setAnnouncementImageDataUrls((prev) => [...prev, ...urls]);
      setError(null);
    } catch (err) {
      setError((err as Error).message || '读取公告图片失败');
    } finally {
      event.target.value = '';
    }
  };

  const uploadAnnouncementImages = async (): Promise<string[]> => {
    if (!announcementImageDataUrls.length) return [];
    const authHeaders = await getAuthorizedBillingHeaders();
    const res = await fetch('/api/announcement/images', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify({ images: announcementImageDataUrls }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || '公告图片上传失败');
    }
    return Array.isArray(data?.urls) ? data.urls : [];
  };

  const handleSaveAnnouncement = async () => {
    if (!isAdmin) return;
    if (!announcementForm.content.trim()) {
      setError('公告内容不能为空');
      return;
    }

    setIsSavingAnnouncement(true);
    setError(null);
    try {
      const imageUrls = await uploadAnnouncementImages();
      const authHeaders = await getAuthorizedBillingHeaders();
      const res = await fetch('/api/announcement', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders,
        },
        body: JSON.stringify({
          title: announcementForm.title,
          content: announcementForm.content,
          active: announcementForm.active,
          pinned: announcementForm.pinned,
          images: imageUrls,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || '发布公告失败');
      }

      toast.success('公告已发布');
      setAnnouncementForm({
        title: '',
        content: '',
        active: true,
        pinned: false,
      });
      setAnnouncementImageDataUrls([]);
      setAnnouncementSearchInput('');
      setAnnouncementSearchKeyword('');
      await fetchAnnouncements({ page: 1, search: '' });
    } catch (err) {
      setError((err as Error).message || '发布公告失败');
    } finally {
      setIsSavingAnnouncement(false);
    }
  };

  const patchAnnouncement = async (announcementId: string, patch: Record<string, unknown>) => {
    const authHeaders = await getAuthorizedBillingHeaders();
    const res = await fetch(`/api/announcement/${encodeURIComponent(announcementId)}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders,
      },
      body: JSON.stringify(patch),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data?.error || '更新公告失败');
    }
  };

  const handleTogglePinned = async (announcementId: string, pinned: boolean) => {
    try {
      setPinningAnnouncementId(announcementId);
      setError(null);
      await patchAnnouncement(announcementId, { pinned: !pinned });
      toast.success(pinned ? '已取消置顶' : '已置顶公告');
      await fetchAnnouncements({ page: announcementPage, search: announcementSearchKeyword });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPinningAnnouncementId(null);
    }
  };

  const handleToggleActive = async (announcementId: string, active: boolean) => {
    try {
      setActivatingAnnouncementId(announcementId);
      setError(null);
      await patchAnnouncement(announcementId, { active: !active });
      toast.success(active ? '公告已停用' : '公告已启用');
      await fetchAnnouncements({ page: announcementPage, search: announcementSearchKeyword });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setActivatingAnnouncementId(null);
    }
  };

  const handleDeleteAnnouncement = async (announcementId: string) => {
    try {
      setDeletingAnnouncementId(announcementId);
      setError(null);
      const authHeaders = await getAuthorizedBillingHeaders();
      const res = await fetch(`/api/announcement/${encodeURIComponent(announcementId)}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data?.error || '删除公告失败');
      }
      toast.success('公告已删除');
      await fetchAnnouncements({ page: announcementPage, search: announcementSearchKeyword });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setDeletingAnnouncementId(null);
    }
  };

  if (!isAdmin) return null;

  return (
    <div className="space-y-4 rounded-3xl border border-cyan-500/20 bg-linear-to-br from-cyan-500/10 via-cyan-500/5 to-transparent p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-cyan-100">
            <Megaphone size={16} />
            公告管理
          </div>
          <p className="mt-1 text-xs leading-6 text-cyan-100/70">
            在后台统一发布、置顶、启停和删除站内公告，普通管理员和超级管理员都可以使用这块工作区。
          </p>
        </div>

        <button
          type="button"
          onClick={() =>
            void fetchAnnouncements({ page: announcementPage, search: announcementSearchKeyword })
          }
          disabled={isLoadingAnnouncements}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-xs text-gray-200 hover:bg-white/10 disabled:opacity-50"
        >
          {isLoadingAnnouncements ? (
            <Loader2 size={13} className="animate-spin" />
          ) : (
            <RefreshCw size={13} />
          )}
          刷新
        </button>
      </div>

      {error && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="text-sm font-medium text-white">发布新公告</div>

          <input
            value={announcementForm.title}
            onChange={(event) =>
              setAnnouncementForm((prev) => ({ ...prev, title: event.target.value }))
            }
            className="h-10 w-full rounded-xl border border-white/10 bg-black/25 px-3 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
            placeholder="系统公告"
          />

          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-200">
              <input
                type="checkbox"
                checked={announcementForm.active}
                onChange={(event) =>
                  setAnnouncementForm((prev) => ({ ...prev, active: event.target.checked }))
                }
              />
              启用公告
            </label>
            <label className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-gray-200">
              <input
                type="checkbox"
                checked={announcementForm.pinned}
                onChange={(event) =>
                  setAnnouncementForm((prev) => ({ ...prev, pinned: event.target.checked }))
                }
              />
              置顶公告
            </label>
          </div>

          <textarea
            value={announcementForm.content}
            onChange={(event) =>
              setAnnouncementForm((prev) => ({ ...prev, content: event.target.value }))
            }
            className="min-h-[140px] w-full rounded-2xl border border-white/10 bg-black/25 px-3 py-2.5 text-sm text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
            placeholder="输入公告内容..."
          />

          <div>
            <div className="mb-2 flex items-center justify-between text-xs text-gray-400">
              <span>公告图片（最多 9 张）</span>
              <span>{announcementImageDataUrls.length}/9</span>
            </div>
            <input
              ref={announcementImageInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={handleSelectAnnouncementImages}
            />
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => announcementImageInputRef.current?.click()}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-white hover:bg-white/10"
              >
                <Upload size={12} />
                上传图片
              </button>
              {announcementImageDataUrls.length > 0 && (
                <button
                  type="button"
                  onClick={() => setAnnouncementImageDataUrls([])}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-red-500/30 bg-red-500/10 px-3 text-xs text-red-200 hover:bg-red-500/15"
                >
                  <Trash2 size={12} />
                  清空图片
                </button>
              )}
            </div>

            {announcementImageDataUrls.length > 0 && (
              <div className="mt-3 grid grid-cols-4 gap-2">
                {announcementImageDataUrls.map((src, idx) => (
                  <div
                    key={`${src.slice(0, 24)}-${idx}`}
                    className="group relative overflow-hidden rounded-xl border border-white/10 bg-black/30"
                  >
                    <img
                      src={src}
                      alt={`announcement-preview-${idx + 1}`}
                      className="h-16 w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setAnnouncementImageDataUrls((prev) => prev.filter((_, i) => i !== idx))
                      }
                      className="absolute right-1 top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white group-hover:inline-flex"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => void handleSaveAnnouncement()}
              disabled={isSavingAnnouncement}
              className="inline-flex h-10 items-center gap-2 rounded-xl bg-cyan-600 px-4 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-60"
            >
              {isSavingAnnouncement ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
              立即发布
            </button>
          </div>
        </div>

        <div className="space-y-3 rounded-2xl border border-white/10 bg-black/20 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-medium text-white">历史公告</div>
            <div className="flex items-center gap-2 text-xs text-gray-400">
              <span>共 {announcementTotal} 条</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search
                size={13}
                className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-500"
              />
              <input
                value={announcementSearchInput}
                onChange={(event) => setAnnouncementSearchInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    setAnnouncementSearchKeyword(announcementSearchInput.trim());
                    void fetchAnnouncements({
                      page: 1,
                      search: announcementSearchInput.trim(),
                    });
                  }
                }}
                className="h-9 w-full rounded-xl border border-white/10 bg-black/25 pl-8 pr-3 text-xs text-white placeholder:text-gray-500 focus:border-white/20 focus:outline-none"
                placeholder="搜索标题或内容"
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setAnnouncementSearchKeyword(announcementSearchInput.trim());
                void fetchAnnouncements({
                  page: 1,
                  search: announcementSearchInput.trim(),
                });
              }}
              disabled={isLoadingAnnouncements}
              className="inline-flex h-9 items-center rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-white hover:bg-white/10 disabled:opacity-50"
            >
              搜索
            </button>
          </div>

          <div className="max-h-[520px] space-y-2 overflow-y-auto pr-1">
            {announcementItems.length === 0 ? (
              <div className="rounded-xl border border-white/5 bg-white/[0.03] px-3 py-8 text-center text-xs text-gray-500">
                暂无公告
              </div>
            ) : (
              announcementItems.map((item) => (
                <div
                  key={item.id}
                  className="rounded-2xl border border-white/5 bg-white/[0.03] px-3 py-3 text-xs"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-medium text-white">
                          {item.title || '系统公告'}
                        </span>
                        {item.pinned && (
                          <span className="rounded-full bg-yellow-500/20 px-2 py-0.5 text-[10px] text-yellow-300">
                            置顶
                          </span>
                        )}
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] ${
                            item.active
                              ? 'bg-emerald-500/15 text-emerald-200'
                              : 'bg-gray-500/20 text-gray-300'
                          }`}
                        >
                          {item.active ? '启用' : '停用'}
                        </span>
                        {!!item.images?.length && (
                          <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] text-sky-200">
                            <ImageIcon size={10} />
                            {item.images.length}
                          </span>
                        )}
                      </div>
                      <div className="mt-1 text-[11px] text-gray-500">
                        {item.date ? new Date(item.date).toLocaleString() : '-'}
                      </div>
                      <div className="mt-2 line-clamp-3 text-[12px] leading-6 text-gray-300">
                        {item.content}
                      </div>
                      {!!item.images?.length && (
                        <div className="mt-3 grid grid-cols-4 gap-2">
                          {item.images.slice(0, 4).map((src, idx) => (
                            <img
                              key={`${src}-${idx}`}
                              src={src}
                              alt={`announcement-${idx + 1}`}
                              className="h-14 w-full rounded-lg border border-white/10 object-cover"
                            />
                          ))}
                        </div>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        type="button"
                        onClick={() => void handleToggleActive(item.id, item.active === true)}
                        disabled={activatingAnnouncementId === item.id}
                        className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors disabled:opacity-50 ${
                          item.active
                            ? 'border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/15'
                            : 'border-gray-500/30 text-gray-300 hover:bg-gray-500/15'
                        }`}
                        title={item.active ? '停用公告' : '启用公告'}
                      >
                        {activatingAnnouncementId === item.id ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : item.active ? (
                          <PowerOff size={13} />
                        ) : (
                          <Power size={13} />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleTogglePinned(item.id, item.pinned === true)}
                        disabled={pinningAnnouncementId === item.id}
                        className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors disabled:opacity-50 ${
                          item.pinned
                            ? 'border-yellow-500/40 text-yellow-300 hover:bg-yellow-500/15'
                            : 'border-white/15 text-gray-300 hover:bg-white/10'
                        }`}
                        title={item.pinned ? '取消置顶' : '置顶公告'}
                      >
                        {pinningAnnouncementId === item.id ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : item.pinned ? (
                          <PinOff size={13} />
                        ) : (
                          <Pin size={13} />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteAnnouncement(item.id)}
                        disabled={deletingAnnouncementId === item.id}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-500/30 text-red-300 hover:bg-red-500/15 disabled:opacity-50"
                        title="删除公告"
                      >
                        {deletingAnnouncementId === item.id ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : (
                          <Trash2 size={13} />
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="flex items-center justify-between text-[11px] text-gray-400">
            <span>
              第 {announcementPage}/{announcementTotalPages} 页
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => {
                  const target = Math.max(1, announcementPage - 1);
                  void fetchAnnouncements({
                    page: target,
                    search: announcementSearchKeyword,
                  });
                }}
                disabled={announcementPage <= 1 || isLoadingAnnouncements}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/5 hover:bg-white/10 disabled:opacity-40"
                title="上一页"
              >
                <ChevronLeft size={12} />
              </button>
              <button
                type="button"
                onClick={() => {
                  const target = Math.min(announcementTotalPages, announcementPage + 1);
                  void fetchAnnouncements({
                    page: target,
                    search: announcementSearchKeyword,
                  });
                }}
                disabled={announcementPage >= announcementTotalPages || isLoadingAnnouncements}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-white/10 bg-white/5 hover:bg-white/10 disabled:opacity-40"
                title="下一页"
              >
                <ChevronRight size={12} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AnnouncementAdminPanel;
