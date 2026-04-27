import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, CheckCheck, Megaphone, ReceiptText, UserRound, Wallet, X } from 'lucide-react';
import PricingReferencePanel from './PricingReferencePanel';
import { fetchBillingAccount } from '../src/services/accountService';
import {
  AUTH_SESSION_CHANGE_EVENT,
  getStoredAuthSessionToken,
} from '../src/services/accountIdentity';
import { formatPoint } from '../src/utils/pointFormat';

interface Announcement {
  id: string;
  title: string;
  content: string;
  active: boolean;
  date: string;
  pinned?: boolean;
  images?: string[];
}

const SEEN_STORAGE_KEY = 'seen_announcement_ids';

const readSeenAnnouncementIds = (): string[] => {
  try {
    const raw = localStorage.getItem(SEEN_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item) => String(item));
  } catch {
    return [];
  }
};

const writeSeenAnnouncementIds = (ids: string[]) => {
  try {
    localStorage.setItem(SEEN_STORAGE_KEY, JSON.stringify(Array.from(new Set(ids))));
  } catch {}
};

const formatAnnouncementDate = (input?: string) => {
  if (!input) return '';
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString();
};

interface AnnouncementPopupProps {
  onOpenSettings?: () => void;
}

const AnnouncementPopup: React.FC<AnnouncementPopupProps> = ({ onOpenSettings }) => {
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [seenIds, setSeenIds] = useState<string[]>(() => readSeenAnnouncementIds());
  const [isCenterOpen, setIsCenterOpen] = useState(false);
  const [isPricingOpen, setIsPricingOpen] = useState(false);
  const [isPopupOpen, setIsPopupOpen] = useState(false);
  const [selectedAnnouncement, setSelectedAnnouncement] = useState<Announcement | null>(null);
  const [accountSummary, setAccountSummary] = useState<{
    email: string;
    displayName: string;
    points: number;
  } | null>(null);
  const centerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    fetch('/api/announcements?page=1&pageSize=50')
      .then((res) => {
        if (!res.ok) {
          console.warn(`[Announcement] Failed to fetch: ${res.status}`);
          return null;
        }
        return res.json();
      })
      .then((data) => {
        const list: Announcement[] = Array.isArray(data?.items) ? data.items : [];
        const activeList = list.filter((item) => item?.active && item?.content);
        setAnnouncements(activeList);

        const latestUnread = activeList.find((item) => !seenIds.includes(item.id));
        if (latestUnread) {
          setSelectedAnnouncement(latestUnread);
          setIsPopupOpen(true);
        }
      })
      .catch((err) => {
        console.warn('[Announcement] Failed to fetch announcements', err);
      });
  }, [seenIds]);

  useEffect(() => {
    let active = true;
    const loadAccountSummary = async () => {
      if (!getStoredAuthSessionToken()) {
        if (active) setAccountSummary(null);
        return;
      }
      try {
        const data = await fetchBillingAccount({ ledgerPageSize: 1 });
        if (!active) return;
        setAccountSummary({
          email: data.user?.email || data.account.ownerEmail || '',
          displayName: data.user?.displayName || data.user?.email || '已登录',
          points: data.account.points || 0,
        });
      } catch (_) {
        if (active) setAccountSummary(null);
      }
    };

    void loadAccountSummary();
    if (typeof window === 'undefined') {
      return () => {
        active = false;
      };
    }
    window.addEventListener(AUTH_SESSION_CHANGE_EVENT, loadAccountSummary);
    window.addEventListener('storage', loadAccountSummary);
    return () => {
      active = false;
      window.removeEventListener(AUTH_SESSION_CHANGE_EVENT, loadAccountSummary);
      window.removeEventListener('storage', loadAccountSummary);
    };
  }, []);

  useEffect(() => {
    if (!isCenterOpen) return;
    const onMouseDown = (event: MouseEvent) => {
      if (centerRef.current && !centerRef.current.contains(event.target as Node)) {
        setIsCenterOpen(false);
      }
    };
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, [isCenterOpen]);

  const markAnnouncementsRead = (ids: string[]) => {
    if (!ids.length) return;
    const next = Array.from(new Set([...seenIds, ...ids.map((id) => String(id))]));
    setSeenIds(next);
    writeSeenAnnouncementIds(next);
  };

  const unreadIds = useMemo(
    () => announcements.filter((item) => !seenIds.includes(item.id)).map((item) => item.id),
    [announcements, seenIds]
  );
  const hasUnread = unreadIds.length > 0;

  const openAnnouncement = (item: Announcement) => {
    setSelectedAnnouncement(item);
    setIsPopupOpen(true);
    markAnnouncementsRead([item.id]);
  };

  const closePopup = () => {
    if (selectedAnnouncement?.id) {
      markAnnouncementsRead([selectedAnnouncement.id]);
    }
    setIsPopupOpen(false);
  };

  const markAllRead = () => {
    markAnnouncementsRead(announcements.map((item) => item.id));
    setIsPopupOpen(false);
  };

  return (
    <>
      <div className="fixed top-4 right-4 sm:top-5 sm:right-6 z-[72] flex items-center gap-2">
        <button
          type="button"
          onClick={() => setIsCenterOpen((prev) => !prev)}
          className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl border border-white/12 bg-[#171b24]/92 text-gray-200 shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur-xl transition-all hover:border-white/25 hover:bg-[#1d2431] hover:text-white"
          title="查看公告"
        >
          <Bell size={16} />
          {hasUnread && (
            <span className="absolute top-2 right-2 h-2.5 w-2.5 rounded-full bg-red-500 shadow-[0_0_10px_rgba(239,68,68,0.85)]" />
          )}
        </button>
        <button
          type="button"
          onClick={() => {
            setIsPricingOpen(true);
            setIsCenterOpen(false);
          }}
          className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl border border-yellow-400/25 bg-[#171b24]/92 text-yellow-200 shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur-xl transition-all hover:border-yellow-300/45 hover:bg-[#24220f] hover:text-yellow-100"
          title="查看价格表"
        >
          <ReceiptText size={16} />
        </button>
        <button
          type="button"
          onClick={onOpenSettings}
          className="hidden h-10 max-w-[220px] items-center gap-2 rounded-xl border border-white/12 bg-[#171b24]/92 px-3 text-left text-gray-200 shadow-[0_10px_30px_rgba(0,0,0,0.35)] backdrop-blur-xl transition-all hover:border-white/25 hover:bg-[#1d2431] hover:text-white sm:inline-flex"
          title={accountSummary ? '账户余额' : '登录 / 账户'}
        >
          {accountSummary ? <Wallet size={16} className="text-emerald-300" /> : <UserRound size={16} />}
          <span className="min-w-0 truncate text-xs font-semibold">
            {accountSummary ? `${formatPoint(accountSummary.points)} 点` : '登录 / 账户'}
          </span>
        </button>
      </div>

      <PricingReferencePanel isOpen={isPricingOpen} onClose={() => setIsPricingOpen(false)} />

      {isCenterOpen && (
        <div ref={centerRef} className="fixed top-16 right-4 sm:top-[72px] sm:right-6 z-[72] w-[360px] max-w-[calc(100vw-1.5rem)]">
          <div className="overflow-hidden rounded-2xl border border-white/12 bg-[#11151d]/96 shadow-[0_25px_60px_rgba(0,0,0,0.55)] backdrop-blur-xl">
            <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
              <div className="flex items-center gap-2 text-white">
                <Megaphone size={16} className="text-blue-300" />
                <span className="text-sm font-semibold tracking-wide">通知</span>
              </div>
              <button
                type="button"
                onClick={markAllRead}
                disabled={announcements.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-xs text-gray-300 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
              >
                <CheckCheck size={12} />
                全部已读
              </button>
            </div>

            <div className="max-h-[62vh] overflow-y-auto sleek-scroll-y">
              {announcements.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-gray-400">暂无公告</div>
              ) : (
                announcements.map((item) => {
                  const unread = !seenIds.includes(item.id);
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => openAnnouncement(item)}
                      className="group relative w-full border-b border-white/6 px-4 py-3 text-left transition-colors hover:bg-white/[0.04]"
                    >
                      <div className="pr-4">
                        <div className="text-sm font-semibold text-white">{item.title || '系统公告'}</div>
                        {item.pinned && (
                          <span className="inline-flex mt-1 text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-300">置顶</span>
                        )}
                        {!!item.images?.length && (
                          <div className="mt-2">
                            <img
                              src={item.images[0]}
                              alt="announcement"
                              className="h-20 w-full rounded-lg border border-white/10 object-cover"
                              loading="lazy"
                            />
                            {item.images.length > 1 && (
                              <div className="mt-1 text-[10px] text-blue-300">共 {item.images.length} 张图片</div>
                            )}
                          </div>
                        )}
                        <div className="mt-1.5 text-xs leading-relaxed text-gray-300 line-clamp-4">{item.content}</div>
                        <div className="mt-2 text-[11px] text-gray-500">{formatAnnouncementDate(item.date)}</div>
                      </div>
                      {unread && (
                        <span className="absolute right-4 top-1/2 -translate-y-1/2 h-2 w-2 rounded-full bg-blue-400" />
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>
      )}

      {isPopupOpen && selectedAnnouncement && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center px-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-yellow-500/20 bg-[#18181b] shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between border-b border-white/5 bg-gradient-to-r from-yellow-500/10 to-transparent p-4">
              <div className="flex items-center gap-3">
                <div className="rounded-lg bg-yellow-500/10 p-2 text-yellow-500">
                  <Megaphone size={20} />
                </div>
                <div>
                  <h3 className="font-medium tracking-wide text-white">{selectedAnnouncement.title || '系统公告'}</h3>
                  <span className="mt-0.5 block text-[10px] text-gray-500">
                    {formatAnnouncementDate(selectedAnnouncement.date)}
                  </span>
                </div>
              </div>
              <button
                type="button"
                onClick={closePopup}
                className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X size={20} />
              </button>
            </div>

            <div className="p-6">
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-gray-300">
                {selectedAnnouncement.content}
              </div>
              {!!selectedAnnouncement.images?.length && (
                <div className="mt-4 grid grid-cols-2 gap-2">
                  {selectedAnnouncement.images.map((img, idx) => (
                    <button
                      key={`${img}-${idx}`}
                      type="button"
                      onClick={() => window.open(img, '_blank', 'noopener,noreferrer')}
                      className="overflow-hidden rounded-lg border border-white/10 bg-black/20"
                    >
                      <img
                        src={img}
                        alt={`announcement-${idx + 1}`}
                        className="h-28 w-full object-cover"
                        loading="lazy"
                      />
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="flex justify-end border-t border-white/5 bg-white/2 p-4">
              <button
                type="button"
                onClick={closePopup}
                className="rounded-lg border border-white/10 bg-white/10 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-white/20"
              >
                我知道了
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default AnnouncementPopup;
