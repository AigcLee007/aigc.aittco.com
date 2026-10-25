import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ImageFormConfig from './ImageFormConfig';
import { useSelectionStore } from '../src/store/selectionStore';

describe('ImageFormConfig transfer controls', () => {
  it('shows fast transfer and auto download beside the line, without format, compression or moderation', () => {
    useSelectionStore.setState({ imageModel: 'gpt-image-2.5-sunburst', autoDownloadOnSuccess: true } as any);
    render(<ImageFormConfig />);
    expect(screen.getByRole('switch', { name: '极速传输' })).toBeTruthy();
    expect((screen.getByLabelText('自动下载') as HTMLInputElement).checked).toBe(true);
    for (const removed of ['格式', '压缩率', '审核强度']) expect(screen.queryByText(removed)).toBeNull();
  });
});
