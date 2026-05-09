import { get, set, del, keys } from 'idb-keyval';
import { v4 as uuidv4 } from 'uuid';

const ASSET_STORE_PREFIX = 'asset-';

export const assetStorage = {
  /**
   * Stores a blob in IndexedDB and returns a unique asset ID.
   */
  async storeBlob(blob: Blob): Promise<string> {
    const assetId = uuidv4();
    const key = `${ASSET_STORE_PREFIX}${assetId}`;
    await set(key, blob);
    return assetId;
  },

  /**
   * Retrieves a blob by asset ID.
   */
  async getBlob(assetId: string): Promise<Blob | undefined> {
    const key = `${ASSET_STORE_PREFIX}${assetId}`;
    return await get(key);
  },

  /**
   * Removes a blob by asset ID.
   */
  async deleteBlob(assetId: string): Promise<void> {
    const key = `${ASSET_STORE_PREFIX}${assetId}`;
    await del(key);
  },

  async cleanupUnusedAssets(activeAssetIds: Iterable<string>): Promise<{ removed: number; kept: number }> {
    const active = new Set(
      Array.from(activeAssetIds || [])
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    );
    const allKeys = await keys();
    let removed = 0;
    let kept = 0;

    await Promise.all(
      allKeys.map(async (key) => {
        if (typeof key !== 'string' || !key.startsWith(ASSET_STORE_PREFIX)) return;
        const assetId = key.slice(ASSET_STORE_PREFIX.length);
        if (active.has(assetId)) {
          kept += 1;
          return;
        }
        await del(key);
        removed += 1;
      })
    );

    return { removed, kept };
  },

  /**
   * Creates an Object URL for the given asset ID.
   * This handles fetching the blob and creating the URL.
   * Note: The caller is responsible for revoking the URL if needed, 
   * though typically we reuse these for the session lifetime.
   */
  async getAssetUrl(assetId: string): Promise<string | null> {
    const blob = await this.getBlob(assetId);
    if (blob) {
      return URL.createObjectURL(blob);
    }
    return null;
  },

  /**
   * Cleaning up unused assets could be added here later.
   * We would compare all keys in IDB with all assetIds in the store.
   */
};
