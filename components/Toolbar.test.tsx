import 'fake-indexeddb/auto';
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import Toolbar from './Toolbar';

it('opens batch generation directly from the visible canvas toolbar', () => {
  const onOpenBatchModal = vi.fn();
  render(
    <Toolbar
      onUpload={vi.fn()}
      onClearAll={vi.fn()}
      onOpenSettings={vi.fn()}
      onOpenHistory={vi.fn()}
      onOpenInstructions={vi.fn()}
      onArrange={vi.fn()}
      onOpenBatchModal={onOpenBatchModal}
      onDownloadAllCanvas={vi.fn()}
      onOpenClassicMode={vi.fn()}
    />,
  );

  const batchButton = screen.getByRole('button', { name: '批量生图' });
  expect(batchButton.className).not.toContain('invisible');
  fireEvent.click(batchButton);

  expect(onOpenBatchModal).toHaveBeenCalledTimes(1);
});
