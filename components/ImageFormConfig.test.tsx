import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ImageFormConfig from './ImageFormConfig';
import { useSelectionStore } from '../src/store/selectionStore';

describe('ImageFormConfig transfer controls', () => {
  it('shows four-image groups and defaults Midjourney quality to 1', () => {
    useSelectionStore.setState({ imageModel: 'midjourney-v8.2-tehui', imageLine: '特惠线路', quantity: 2, gptImageQuality: 'auto' });
    render(<ImageFormConfig />);
    expect(useSelectionStore.getState().gptImageQuality).toBe('1');
    expect(screen.getByText('组数')).toBeTruthy();
    expect(screen.getByText(/2 组.*8 张/)).toBeTruthy();
    expect(screen.getByText(/每张 2.*每组 4 张.*8/)).toBeTruthy();
    expect(screen.getByText('16.0')).toBeTruthy();
  });
  it.each(['auto', 'xhigh', 'max'] as const)('resets unsupported %s quality to medium on the 2.6 route', (quality) => {
    useSelectionStore.setState({ imageModel: 'gpt-image-2.6-sunburst', imageLine: '原生线路', gptImageQuality: quality });
    render(<ImageFormConfig />);
    expect(useSelectionStore.getState().gptImageQuality).toBe('medium');
    expect(screen.getByText('质量')).toBeTruthy();
  });

  it('shows fast transfer and auto download beside the line, without format, compression or moderation', () => {
    useSelectionStore.setState({ imageModel: 'gpt-image-2.5-sunburst', autoDownloadOnSuccess: true } as any);
    render(<ImageFormConfig />);
    expect(screen.getByRole('switch', { name: '极速传输' })).toBeTruthy();
    expect((screen.getByLabelText('自动下载') as HTMLInputElement).checked).toBe(true);
    for (const removed of ['格式', '压缩率', '审核强度']) expect(screen.queryByText(removed)).toBeNull();
  });
});
