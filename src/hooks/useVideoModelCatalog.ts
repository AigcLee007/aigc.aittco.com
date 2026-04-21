import { useEffect, useState } from 'react';
import {
  ensureVideoModelCatalogLoaded,
  getVideoModelCatalogSnapshot,
  subscribeVideoModelCatalog,
  type VideoModelCatalogShape,
} from '../config/videoModels';

export const useVideoModelCatalog = () => {
  const [catalog, setCatalog] = useState<VideoModelCatalogShape>(() =>
    getVideoModelCatalogSnapshot(),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const syncCatalog = () => {
      if (!active) return;
      setCatalog(getVideoModelCatalogSnapshot());
    };

    const unsubscribe = subscribeVideoModelCatalog(syncCatalog);
    syncCatalog();
    setLoading(true);
    ensureVideoModelCatalogLoaded()
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
    models: catalog.models,
  };
};
