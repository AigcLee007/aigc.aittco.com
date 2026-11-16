import 'fake-indexeddb/auto';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import ImageFormConfig from './ImageFormConfig';
import { useSelectionStore } from '../src/store/selectionStore';

describe('Seedream image form settings', () => {
  beforeEach(() => {
    useSelectionStore.setState({ imageModel: 'seedream-5-pro', gptImageQuality: 'medium' } as any);
  });

  it('does not show the GPT quality selector for Seedream', () => {
    render(<ImageFormConfig />);

    expect(screen.queryByText('质量')).toBeNull();
  });
});
