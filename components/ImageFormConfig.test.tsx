import 'fake-indexeddb/auto';
import { render, screen, act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import ImageFormConfig from './ImageFormConfig';
import { useSelectionStore } from '../src/store/selectionStore';

describe('ImageFormConfig transfer controls', () => {
  it('exposes GIF controls only on the animation route and caps its size at 1K', () => {
    useSelectionStore.setState({
      imageModel: 'gpt-image-2.6-sunburst', imageLine: '动态图片', imageSize: '2k', quantity: 1,
      gptImageOutputFormat: 'gif', gptGifFrameCount: 9, gptGifFrameDuration: 200,
    });
    render(<ImageFormConfig />);
    expect(useSelectionStore.getState().imageSize).toBe('1k');
    expect(screen.getByText('动态 GIF')).toBeTruthy();
    expect((screen.getByLabelText('GIF 帧数') as HTMLInputElement).value).toBe('9');
    expect((screen.getByLabelText('GIF 每帧时长') as HTMLInputElement).value).toBe('200');
    act(() => useSelectionStore.getState().setImageLine('原生线路'));
    expect(screen.queryByText('图片格式')).toBeNull();
    expect(screen.queryByLabelText('GIF 帧数')).toBeNull();
  });
  it('migrates a saved discount selection and quotes 16 coins per four-image group', () => {
    useSelectionStore.setState({ imageModel: 'midjourney-v8.2-tehui', imageLine: '特惠线路', quantity: 2, gptImageQuality: 'auto' });
    render(<ImageFormConfig />);
    expect(useSelectionStore.getState().imageLine).toBe('稳定线路');
    expect(screen.getByText('线路')).toBeTruthy();
    expect(screen.getByText('组数')).toBeTruthy();
    expect(screen.getByText(/2 组.*8 张/)).toBeTruthy();
    expect(screen.getByText(/每张 4.*每组 4 张.*16/)).toBeTruthy();
    expect(screen.getByText('32.0')).toBeTruthy();
  });
  it('keeps the explicitly selected official discount route and quotes 8 points per group', () => {
    useSelectionStore.setState({ imageModel: 'midjourney-v8.2-tehui', imageLine: '官转特价线路', quantity: 2 });
    render(<ImageFormConfig />);
    expect(useSelectionStore.getState().imageLine).toBe('官转特价线路');
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

  it('estimates the Mouxihub input-image fee for every single-image request', () => {
    useSelectionStore.setState({ imageModel: 'seedream-5.5', imageSize: '1k', quantity: 2 });
    render(<ImageFormConfig referenceImageCount={2} />);
    act(() => useSelectionStore.getState().setImageLine('官转线路'));
    expect(screen.getByText('13.0')).toBeTruthy();
    expect(screen.getByText(/单张预计 6.5 点（含 2 张参考图）/)).toBeTruthy();
  });
});
