import { useEffect, useState } from 'react';
import {
  ensureImageRouteCatalogLoaded,
  getImageRouteCatalogSnapshot,
  subscribeImageRouteCatalog,
  type ImageRouteCatalogShape,
} from '../config/imageRoutes';

export const useImageRouteCatalog = () => {
  const [catalog, setCatalog] = useState<ImageRouteCatalogShape>(() =>
    getImageRouteCatalogSnapshot(),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const syncCatalog = () => {
      if (!active) return;
      setCatalog(getImageRouteCatalogSnapshot());
    };

    const unsubscribe = subscribeImageRouteCatalog(syncCatalog);
    syncCatalog();
    setLoading(true);
    ensureImageRouteCatalogLoaded()
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
