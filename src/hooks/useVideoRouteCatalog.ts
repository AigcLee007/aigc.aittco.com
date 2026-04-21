import { useEffect, useState } from 'react';
import {
  ensureVideoRouteCatalogLoaded,
  getVideoRouteCatalogSnapshot,
  subscribeVideoRouteCatalog,
  type VideoRouteCatalogShape,
} from '../config/videoRoutes';

export const useVideoRouteCatalog = () => {
  const [catalog, setCatalog] = useState<VideoRouteCatalogShape>(() =>
    getVideoRouteCatalogSnapshot(),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const syncCatalog = () => {
      if (!active) return;
      setCatalog(getVideoRouteCatalogSnapshot());
    };

    const unsubscribe = subscribeVideoRouteCatalog(syncCatalog);
    syncCatalog();
    setLoading(true);
    ensureVideoRouteCatalogLoaded()
      .then(() => {
        if (!active) return;
        syncCatalog();
        setError(null);
      })
      .catch((err) => {
        if (!active) return;
        setError((err as Error).message);
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  return {
    catalog,
    loading,
    error,
    routes: catalog.routes,
  };
};
