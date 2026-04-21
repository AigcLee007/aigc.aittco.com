import React from 'react';
import { X } from 'lucide-react';

interface VideoPricingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const VideoPricingModal: React.FC<VideoPricingModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  const items = [
    { name: 'veo3.1-fast', price: 5, desc: '\u652F\u6301\u9996\u5C3E\u5E27\uFF082 \u56FE\uFF09' },
    { name: 'veo3.1-components', price: 7.5, desc: '\u652F\u6301\u591A\u56FE\u878D\u5408\uFF08\u6700\u591A 3 \u56FE\uFF09' },
    { name: 'grok-video-3', price: 12.5, desc: '5s / 10s / 15s' },
    { name: 'veo3.1-pro', price: 25, desc: '\u4E0E veo3.1-fast-4K \u540C\u63A5\u53E3\u4E0E\u53C2\u6570\uFF0C\u652F\u6301\u9996\u5C3E\u5E27' },
    { name: 'veo3.1-fast-4K', price: 50, desc: '\u652F\u6301\u9996\u5C3E\u5E27\uFF082 \u56FE\uFF09' },
    { name: 'veo3.1-fast-components-4K', price: 50, desc: 'Fast Components 4K' },
    { name: 'veo3.1-pro-4k', price: 50, desc: 'Pro 4K' },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden animate-in fade-in zoom-in duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-gray-800 bg-gray-900/50">
          <h3 className="text-lg font-bold text-white">{'\u89C6\u9891\u6A21\u578B\u8BA1\u8D39\uFF08\u4F4E\u5230\u9AD8\uFF09'}</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors p-1 hover:bg-gray-800 rounded-lg"
          >
            <X size={20} />
          </button>
        </div>

        <div className="p-6 space-y-3 text-sm text-gray-300 max-h-[80vh] overflow-y-auto">
          {items.map((item) => (
            <div key={item.name} className="flex justify-between items-center bg-gray-800/50 p-3 rounded-lg border border-gray-800">
              <div>
                <div className="font-bold text-white">{item.name}</div>
                <div className="text-xs text-gray-400 mt-1">{item.desc}</div>
              </div>
              <div className="text-yellow-300 font-mono font-bold whitespace-nowrap">{item.price} {'\u91D1\u5E01/\u6B21'}</div>
            </div>
          ))}
        </div>

        <div className="p-4 bg-gray-900/80 border-t border-gray-800 text-center text-xs text-gray-500">
          {'\u70B9\u51FB\u906E\u7F69\u5C42\u6216\u53F3\u4E0A\u89D2\u5173\u95ED'}
        </div>
      </div>
    </div>
  );
};

export default VideoPricingModal;
