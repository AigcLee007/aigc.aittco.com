// Invoke the exported function in an isolated /vip browser origin, never a user's profile.
module.exports = async function classicAssetBrowserFixture() {
  closeApiGuideModal();
  const canvas = document.createElement('canvas');
  canvas.width = 4096;
  canvas.height = 2048;
  canvas.getContext('2d').fillRect(0, 0, canvas.width, canvas.height);
  const original = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  canvas.width = canvas.height = 1;
  const id = `classic-browser-fixture-${Date.now()}`;
  const src = `/missing-original-${id}.png`;
  await writeClassicImageCache(HISTORY_CACHE_STORE, id, { blob: original });
  classicLiveTasks = [{ id, status: 'success', originalUrl: src, previewUrl: '', prompt: 'Legacy original cache fixture', index: 1, createdAt: Date.now(), updatedAt: Date.now() }];
  renderClassicLiveTasks();
  document.getElementById('classicLiveGrid').scrollIntoView();
  const wait = async (predicate) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('Classic browser fixture did not settle within 5 seconds');
  };
  await wait(() => document.querySelector('#classicLiveGrid img')?.src.startsWith('blob:'));
  const image = document.querySelector('#classicLiveGrid img');
  await image.decode();
  const card = image.closest('.classic-live-card');
  const originalAsset = await getClassicOriginalAsset(src);
  const result = {
    preview: { width: image.naturalWidth, height: image.naturalHeight, state: image.dataset.imageState },
    original: { source: originalAsset.source, bytes: originalAsset.blob.size, cachedBytes: original.size },
  };
  originalAsset.release();
  classicLiveTasks.push({ id: `${id}-pending`, status: 'running', index: 2, createdAt: Date.now(), updatedAt: Date.now() });
  renderClassicLiveTasks();
  const stableBefore = image === document.querySelector('#classicLiveGrid img');
  classicLiveTasks[1].status = 'failed';
  classicLiveTasks[1].updatedAt = Date.now();
  renderClassicLiveTasks();
  result.sameCompletedCardAfterOtherTaskUpdates = stableBefore && card === document.querySelector('#classicLiveGrid .classic-live-card') && image === document.querySelector('#classicLiveGrid img');

  const revoked = [];
  const revoke = URL.revokeObjectURL.bind(URL);
  URL.revokeObjectURL = (url) => { revoked.push(url); revoke(url); };
  try {
    await openLightbox(src);
    const lightboxImage = document.getElementById('lbImg');
    await lightboxImage.decode();
    result.lightbox = { width: lightboxImage.naturalWidth, height: lightboxImage.naturalHeight };
    const originalUrl = lightboxImage.src;
    closeLightbox();
    result.lightbox.cleared = lightboxImage.getAttribute('src') === null;
    result.lightbox.revoked = revoked.includes(originalUrl);
  } finally { URL.revokeObjectURL = revoke; }

  window.scrollTo(0, 0);
  await wait(() => image.getAttribute('src') === null);
  result.offscreenCleared = image.getAttribute('src') === null;
  card.scrollIntoView();
  await wait(() => image.src.startsWith('blob:'));
  result.previewRestored = image.src.startsWith('blob:');

  const raceCard = document.createElement('div');
  const raceImage = document.createElement('img');
  raceCard.className = 'classic-live-card';
  raceCard.style.height = '200px';
  raceImage.width = 180;
  raceImage.height = 100;
  raceCard.appendChild(raceImage);
  document.getElementById('classicLiveGrid').appendChild(raceCard);
  let rapidReads = 0;
  let finishCancelled;
  let firstSignal;
  let staleReleased = 0;
  const rapidBinder = window.ClassicImageRuntime.createImageBinder({
    reader: {
      acquire(input) {
        rapidReads++;
        if (rapidReads === 1) {
          firstSignal = input.signal;
          return new Promise((resolve) => { finishCancelled = resolve; });
        }
        return getClassicImageReader().acquire(input);
      },
    },
  });
  rapidBinder.bind(raceImage, { id, src });
  raceCard.scrollIntoView();
  await wait(() => rapidReads === 1);
  window.scrollTo(0, 0);
  await wait(() => firstSignal.aborted);
  raceCard.scrollIntoView();
  await wait(() => rapidReads === 2 && raceImage.src.startsWith('blob:'));
  const currentPreviewUrl = raceImage.src;
  finishCancelled({ status: 'ready', url: 'blob:cancelled-attempt', release: () => staleReleased++ });
  await wait(() => staleReleased === 1);
  result.rapidViewportReentry = {
    reads: rapidReads,
    firstAborted: firstSignal.aborted,
    restored: raceImage.src === currentPreviewUrl,
    staleReleased,
  };
  rapidBinder.unbind(raceImage);
  raceCard.remove();

  const badCard = document.createElement('div');
  const badImage = document.createElement('img');
  badCard.className = 'classic-live-card';
  badCard.style.height = '200px';
  badCard.appendChild(badImage);
  document.getElementById('classicLiveGrid').appendChild(badCard);
  bindClassicPreviewImage(badImage, { id: `${id}-missing`, src: `/missing-${id}.png` });
  badCard.scrollIntoView();
  await wait(() => badCard.textContent.includes('重试读取'));
  result.missingImageState = badCard.textContent;
  result.missingImageRetryVisible = badCard.textContent.includes('重试读取');
  result.passed = result.preview.width === 720 && result.preview.height === 360 &&
    result.original.source === 'local' && result.original.bytes === result.original.cachedBytes &&
    result.sameCompletedCardAfterOtherTaskUpdates && result.lightbox.width === 4096 && result.lightbox.height === 2048 &&
    result.lightbox.cleared && result.lightbox.revoked && result.offscreenCleared && result.previewRestored && result.missingImageRetryVisible &&
    result.rapidViewportReentry.reads === 2 && result.rapidViewportReentry.firstAborted && result.rapidViewportReentry.restored && result.rapidViewportReentry.staleReleased === 1;
  if (!result.passed) throw new Error(JSON.stringify(result));
  return result;
};
