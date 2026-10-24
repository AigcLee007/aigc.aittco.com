import { useEffect, useState } from 'react';
import { refreshImageModelCatalog } from '../config/imageModels';
import { refreshImageRouteCatalog } from '../config/imageRoutes';

declare const __APP_BUILD_ID__: string;

interface VersionInfo {
  buildId: string;
  catalogVersion: string;
}

export const AppVersionNotice = () => {
  const [updateAvailable, setUpdateAvailable] = useState(false);

  useEffect(() => {
    let stopped = false;
    let knownCatalogVersion = '';
    let timer: number | undefined;

    const checkVersion = async () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      try {
        const response = await fetch('/api/version', { cache: 'no-store' });
        if (!response.ok) return;
        const version = (await response.json()) as VersionInfo;
        if (stopped) return;
        if (version.buildId && version.buildId !== __APP_BUILD_ID__) setUpdateAvailable(true);
        if (!knownCatalogVersion) {
          knownCatalogVersion = version.catalogVersion || '';
        } else if (version.catalogVersion !== knownCatalogVersion) {
          const refreshes = await Promise.allSettled([refreshImageModelCatalog(), refreshImageRouteCatalog()]);
          if (refreshes.some((result) => result.status === 'rejected')) return;
          knownCatalogVersion = version.catalogVersion;
        }
      } catch {
        // Keep the current UI when the version endpoint is temporarily unavailable.
      }
    };

    const schedule = () => {
      window.clearInterval(timer);
      timer = window.setInterval(() => void checkVersion(), 60_000);
      void checkVersion();
    };

    schedule();
    window.addEventListener('focus', schedule);
    window.addEventListener('online', schedule);
    document.addEventListener('visibilitychange', schedule);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', schedule);
      window.removeEventListener('online', schedule);
      document.removeEventListener('visibilitychange', schedule);
    };
  }, []);

  if (!updateAvailable) return null;
  return (
    <div className="fixed top-3 left-1/2 z-[120] flex max-w-[calc(100vw-24px)] -translate-x-1/2 items-center gap-3 border border-emerald-300/30 bg-neutral-950 px-4 py-3 text-sm text-white shadow-xl">
      <span>发现新版本，刷新后生效</span>
      <button className="bg-emerald-400 px-3 py-1.5 font-semibold text-neutral-950" onClick={() => window.location.reload()}>
        立即更新
      </button>
    </div>
  );
};
