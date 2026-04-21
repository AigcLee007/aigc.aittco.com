import { useEffect, useState } from 'react';
import {
  ensureImageModelCatalogLoaded,
  getImageModelCatalogSnapshot,
  subscribeImageModelCatalog,
  type ImageModelCatalogShape,
} from '../config/imageModels';

export const useImageModelCatalog = () => {
  const [catalog, setCatalog] = useState<ImageModelCatalogShape>(() =>
    getImageModelCatalogSnapshot(),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const syncCatalog = () => {
      if (!active) return;
      setCatalog(getImageModelCatalogSnapshot());
    };

    const unsubscribe = subscribeImageModelCatalog(syncCatalog);
    syncCatalog();
    setLoading(true);
    ensureImageModelCatalogLoaded()
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
