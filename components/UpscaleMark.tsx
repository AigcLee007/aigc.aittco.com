import React from 'react';

export const UPSCALE_MODE_LABEL = '8K超清';

interface UpscaleMarkProps {
  size?: number;
  className?: string;
}

export const UpscaleMark: React.FC<UpscaleMarkProps> = ({ size = 18, className = '' }) => (
  <img
    src="/8k-ultra-hd.svg"
    alt=""
    aria-hidden="true"
    width={size * 1.5}
    height={size}
    className={`block h-auto shrink-0 ${className}`}
  />
);
