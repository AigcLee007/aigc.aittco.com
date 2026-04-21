export const isLowEndDevice = (): boolean => {
  if (typeof window === 'undefined') return false;

  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { saveData?: boolean };
  };

  const cores = nav.hardwareConcurrency || 8;
  const memory = nav.deviceMemory || 8;
  const saveData = !!nav.connection?.saveData;
  const smallScreen = Math.min(window.innerWidth, window.innerHeight) <= 420;

  // Conservative threshold: low cores + low memory, or user explicitly enabled data saver.
  return saveData || (cores <= 4 && memory <= 4) || (smallScreen && cores <= 4);
};

