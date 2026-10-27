declare const __APP_COMMIT__: string;
declare const __APP_BUILT_AT__: string;

const formatBuiltAt = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

// Shows which build the page is running, so operators can match it to a commit.
export const AppVersionBadge = ({ className = 'bottom-14 sidebar-offset-left' }: { className?: string }) => {
  const commit = typeof __APP_COMMIT__ === 'string' ? __APP_COMMIT__ : 'unknown';
  const builtAt = typeof __APP_BUILT_AT__ === 'string' ? formatBuiltAt(__APP_BUILT_AT__) : '';
  const label = builtAt ? `版本 ${commit} · 构建于 ${builtAt}` : `版本 ${commit}`;
  return (
    <div
      className={`fixed z-40 select-text font-mono text-[10px] leading-none text-white/35 ${className}`}
      title={label}
      aria-label={label}
      data-testid="app-version-badge"
    >
      {commit}
    </div>
  );
};
