import React from 'react';

interface CoinIconProps {
  size?: number;
  className?: string;
}

const CoinIcon: React.FC<CoinIconProps> = ({ size = 24, className = "" }) => (
  <svg 
    width={size} 
    height={size} 
    viewBox="0 0 24 24" 
    fill="none" 
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    style={{ minWidth: size }} /* Prevent shrinking in flex containers */
  >
    <circle cx="12" cy="12" r="10" fill="url(#coin_grad_shared)" stroke="#B45309" strokeWidth="1.5" />
    <circle cx="12" cy="12" r="7" stroke="#F59E0B" strokeWidth="1.5" strokeDasharray="2 3" strokeLinecap="round" />
    <path d="M12 7V17M9 10H15M9 14H15" stroke="#92400E" strokeWidth="2" strokeLinecap="round" />
    <defs>
      <linearGradient id="coin_grad_shared" x1="12" y1="2" x2="12" y2="22" gradientUnits="userSpaceOnUse">
        <stop stopColor="#FCD34D" />
        <stop offset="1" stopColor="#F59E0B" />
      </linearGradient>
    </defs>
  </svg>
);

export default CoinIcon;
