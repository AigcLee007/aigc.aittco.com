import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import AdminOverviewPanel from './AdminOverviewPanel';

describe('billing overview terminology', () => {
  it('distinguishes billing ratios and session activity from generation health', () => {
    render(<AdminOverviewPanel data={null} loading={false} error={null} onRefresh={vi.fn()} />);
    expect(screen.getAllByText(/未退款扣款占比/).length).toBeGreaterThan(0);
    expect(screen.getByText(/不是生成成功率/)).toBeTruthy();
    expect(screen.getAllByText(/旧账务待处理/).length).toBeGreaterThan(0);
    expect(screen.getByText(/在线按最近会话活动统计/)).toBeTruthy();
    expect(screen.queryByText('总站成功率')).toBeNull();
  });
});
