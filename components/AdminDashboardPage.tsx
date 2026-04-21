import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  Boxes,
  CreditCard,
  Loader2,
  Megaphone,
  ShieldCheck,
  Users,
  type LucideIcon,
} from 'lucide-react';
import AuthPanel from './AuthPanel';
import BillingPanel from './BillingPanel';
import UserAdminPanel from './UserAdminPanel';
import AdminOverviewPanel from './AdminOverviewPanel';
import MediaCatalogAdminPanel from './MediaCatalogAdminPanel';
import AnnouncementAdminPanel from './AnnouncementAdminPanel';
import {
  AuthSessionPayload,
  fetchCurrentAuthSession,
} from '../src/services/accountIdentity';
import {
  AdminDashboardPayload,
  fetchAdminDashboard,
} from '../src/services/adminDashboardService';

type AdminSection = 'overview' | 'users' | 'announcements' | 'catalog' | 'account';

interface SectionItem {
  id: AdminSection;
  label: string;
  icon: LucideIcon;
}

const AdminDashboardPage: React.FC = () => {
  const [session, setSession] = useState<AuthSessionPayload | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [dashboard, setDashboard] = useState<AdminDashboardPayload | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<AdminSection>('overview');

  const refreshSession = useCallback(async () => {
    setSessionLoading(true);
    try {
      const nextSession = await fetchCurrentAuthSession();
      setSession(nextSession);
    } finally {
      setSessionLoading(false);
    }
  }, []);

  const loadDashboard = useCallback(async () => {
    if (session?.user?.isAdmin !== true) {
      setDashboard(null);
      return;
    }

    setDashboardLoading(true);
    setDashboardError(null);
    try {
      const next = await fetchAdminDashboard();
      setDashboard(next);
    } catch (error) {
      setDashboardError((error as Error).message);
    } finally {
      setDashboardLoading(false);
    }
  }, [session?.user?.isAdmin]);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  useEffect(() => {
    if (session?.user?.isAdmin !== true) return undefined;
    void loadDashboard();
    const timer = window.setInterval(() => {
      void loadDashboard();
    }, 30000);
    return () => window.clearInterval(timer);
  }, [loadDashboard, session?.user?.isAdmin]);

  const isSuperAdmin = session?.user?.isSuperAdmin === true;

  const sections = useMemo<SectionItem[]>(() => {
    const base: SectionItem[] = [
      { id: 'overview', label: '运行总览', icon: ShieldCheck },
      { id: 'users', label: '用户管理', icon: Users },
      { id: 'announcements', label: '公告管理', icon: Megaphone },
    ];

    if (isSuperAdmin) {
      base.push(
        { id: 'catalog', label: '模型与线路', icon: Boxes },
        { id: 'account', label: '账号与点数', icon: CreditCard },
      );
    }

    return base;
  }, [isSuperAdmin]);

  useEffect(() => {
    if (isSuperAdmin) return;
    if (activeSection === 'catalog' || activeSection === 'account') {
      setActiveSection('overview');
    }
  }, [activeSection, isSuperAdmin]);

  const renderOverview = () => (
    <AdminOverviewPanel
      data={dashboard}
      loading={dashboardLoading}
      error={dashboardError}
      onRefresh={() => void loadDashboard()}
    />
  );

  const renderContent = () => {
    switch (activeSection) {
      case 'users':
        return <UserAdminPanel session={session} />;
      case 'announcements':
        return <AnnouncementAdminPanel session={session} />;
      case 'catalog':
        return isSuperAdmin ? (
          <MediaCatalogAdminPanel
            session={session}
            dashboard={dashboard}
            onRefreshDashboard={() => void loadDashboard()}
          />
        ) : (
          renderOverview()
        );
      case 'account':
        return isSuperAdmin ? (
          <div className="space-y-6">
            <AuthPanel session={session} onSessionChange={setSession} />
            <BillingPanel session={session} />
          </div>
        ) : (
          renderOverview()
        );
      case 'overview':
      default:
        return renderOverview();
    }
  };

  if (sessionLoading) {
    return (
      <div className="min-h-screen bg-neutral-950 text-white">
        <div className="flex min-h-screen items-center justify-center">
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-5 py-4 text-sm text-gray-200">
            <Loader2 size={16} className="animate-spin" />
            正在加载管理后台...
          </div>
        </div>
      </div>
    );
  }

  if (!session?.authenticated) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(34,211,238,0.12),_transparent_35%),linear-gradient(180deg,#020617,#0f172a)] px-4 py-10 text-white">
        <div className="mx-auto max-w-5xl">
          <div className="mb-6 flex items-center justify-between gap-4">
            <div>
              <div className="text-xs uppercase tracking-[0.22em] text-cyan-300">Admin Portal</div>
              <h1 className="mt-2 text-3xl font-semibold">网站管理后台</h1>
              <p className="mt-2 text-sm text-gray-400">
                先登录管理员账号，再进入运行总览、用户管理和公告管理。超级管理员额外拥有模型线路与点数配置权限。
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                window.location.href = '/';
              }}
              className="inline-flex h-11 items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 text-sm text-white hover:bg-white/10"
            >
              <ArrowLeft size={15} />
              返回创作页
            </button>
          </div>
          <AuthPanel session={session} onSessionChange={setSession} />
        </div>
      </div>
    );
  }

  if (session.user.isAdmin !== true) {
    return (
      <div className="min-h-screen bg-neutral-950 px-4 py-10 text-white">
        <div className="mx-auto max-w-5xl space-y-6">
          <div className="rounded-[28px] border border-amber-500/20 bg-amber-500/10 p-6">
            <div className="text-xs uppercase tracking-[0.22em] text-amber-200">Access Denied</div>
            <h1 className="mt-2 text-3xl font-semibold text-white">当前账号没有后台权限</h1>
            <p className="mt-3 text-sm leading-7 text-amber-100/80">
              这个页面只对管理员开放。请退出当前账号后，重新登录管理员或超级管理员账号。
            </p>
          </div>
          <AuthPanel session={session} onSessionChange={setSession} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-y-auto overflow-x-hidden bg-[linear-gradient(180deg,#020617_0%,#0b1120_42%,#020617_100%)] text-white">
      <div className="mx-auto flex min-h-screen max-w-[1700px] gap-6 px-4 py-6 xl:px-6">
        <aside className="hidden w-[280px] shrink-0 xl:block">
          <div className="sticky top-6 rounded-[28px] border border-white/10 bg-white/[0.04] p-5 shadow-[0_18px_60px_rgba(0,0,0,0.32)]">
            <div className="text-xs uppercase tracking-[0.22em] text-cyan-300">Admin Portal</div>
            <div className="mt-3 text-2xl font-semibold text-white">网站管理后台</div>
            <div className="mt-2 text-sm leading-6 text-gray-400">
              普通管理员可查看站点运行、用户消费并发布公告；超级管理员额外拥有模型线路和点数配置权限。
            </div>

            <div className="mt-6 rounded-2xl border border-white/10 bg-black/20 p-4">
              <div className="text-sm font-medium text-white">
                {session.user.displayName || session.user.email}
              </div>
              <div className="mt-1 text-xs text-gray-400">{session.user.email}</div>
              <div className="mt-3 inline-flex rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] uppercase tracking-[0.18em] text-emerald-200">
                {isSuperAdmin ? 'Super Admin' : 'Admin'}
              </div>
            </div>

            <nav className="mt-6 space-y-2">
              {sections.map((section) => {
                const Icon = section.icon;
                const active = activeSection === section.id;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => setActiveSection(section.id)}
                    className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm transition-colors ${
                      active
                        ? 'bg-cyan-500/15 text-white'
                        : 'text-gray-300 hover:bg-white/6 hover:text-white'
                    }`}
                  >
                    <Icon size={16} />
                    {section.label}
                  </button>
                );
              })}
            </nav>

            <button
              type="button"
              onClick={() => {
                window.location.href = '/';
              }}
              className="mt-6 inline-flex h-11 w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/5 text-sm font-medium text-white hover:bg-white/10"
            >
              <ArrowLeft size={15} />
              返回创作页
            </button>
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 xl:hidden">
            <button
              type="button"
              onClick={() => {
                window.location.href = '/';
              }}
              className="inline-flex h-10 items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 text-sm text-white hover:bg-white/10"
            >
              <ArrowLeft size={15} />
              返回创作页
            </button>
            <div className="flex flex-wrap gap-2">
              {sections.map((section) => {
                const Icon = section.icon;
                const active = activeSection === section.id;
                return (
                  <button
                    key={section.id}
                    type="button"
                    onClick={() => setActiveSection(section.id)}
                    className={`inline-flex h-10 items-center gap-2 rounded-2xl border px-4 text-sm ${
                      active
                        ? 'border-cyan-400/30 bg-cyan-400/10 text-white'
                        : 'border-white/10 bg-white/5 text-gray-300'
                    }`}
                  >
                    <Icon size={15} />
                    {section.label}
                  </button>
                );
              })}
            </div>
          </div>

          {renderContent()}
        </main>
      </div>
    </div>
  );
};

export default AdminDashboardPage;
