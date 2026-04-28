const CHINA_TIMEZONE = 'Asia/Shanghai';

const parseTime = (value?: string | number | Date | null): Date | null => {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

export const formatShortTime = (value?: string | number | Date | null): string => {
  const date = parseTime(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: CHINA_TIMEZONE,
  }).format(date);
};

export const formatFullTime = (value?: string | number | Date | null): string => {
  const date = parseTime(value);
  if (!date) return '';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: CHINA_TIMEZONE,
  }).format(date).replace(/\//g, '-');
};

export const formatRelativeTime = (value?: string | number | Date | null): string => {
  const date = parseTime(value);
  if (!date) return '';
  const diffMs = Date.now() - date.getTime();
  const absMs = Math.abs(diffMs);
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (absMs < minute) return '刚刚';
  if (absMs < hour) return `${Math.max(1, Math.round(absMs / minute))}分钟前`;
  if (absMs < day) return `${Math.max(1, Math.round(absMs / hour))}小时前`;
  if (absMs < 7 * day) return `${Math.max(1, Math.round(absMs / day))}天前`;
  return formatFullTime(date);
};
