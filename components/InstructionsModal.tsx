import React from 'react';
import {
  X,
  HelpCircle,
  Sparkles,
  Image as ImageIcon,
  Box,
  LayoutGrid,
  History,
  CheckCircle2,
  Film,
} from 'lucide-react';

interface InstructionsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const InstructionsModal: React.FC<InstructionsModalProps> = ({ isOpen, onClose }) => {
  const sections = [
    {
      icon: <Sparkles className="text-blue-400" size={20} />,
      title: '1. \u529F\u80FD\u652F\u6301',
      content:
        '\u652F\u6301\u63D0\u793A\u8BCD\u4F18\u5316\u3001\u56FE\u7247\u9006\u63A8\u63D0\u793A\u8BCD\u3002\u56FE\u7247\u548C\u89C6\u9891\u751F\u6210\u4EFB\u52A1\u5728\u540E\u7AEF\u5F02\u6B65\u8FD0\u884C\uFF0C\u63D0\u4EA4\u540E\u53EF\u7EE7\u7EED\u64CD\u4F5C\u5176\u4ED6\u4EFB\u52A1\u3002',
    },
    {
      icon: <LayoutGrid className="text-purple-400" size={20} />,
      title: '2. \u753B\u5E03\u7BA1\u7406',
      content:
        '\u652F\u6301\u4E00\u952E\u6574\u7406\u3001\u6253\u5305\u4E0B\u8F7D\u4E0E\u6E05\u7A7A\u753B\u5E03\u3002\u53EF\u4EE5\u5BF9\u56FE\u50CF\u8FDB\u884C\u5FEB\u901F\u6392\u7248\u4E0E\u4E8C\u6B21\u521B\u4F5C\u3002',
    },
    {
      icon: <Box className="text-orange-400" size={20} />,
      title: '3. \u6279\u91CF\u6587\u751F\u56FE',
      content:
        '\u652F\u6301\u901A\u8FC7\u6587\u6863\u6216\u8868\u683C\u6279\u91CF\u89E3\u6790\u63D0\u793A\u8BCD\u3002\u89E3\u6790\u540E\u53EF\u5FEB\u901F\u542F\u52A8\u6279\u91CF\u521B\u5EFA\u3002',
    },
    {
      icon: <ImageIcon className="text-green-400" size={20} />,
      title: '4. \u6279\u91CF\u56FE\u751F\u56FE',
      content:
        '\u53EF\u4E00\u6B21\u4E0A\u4F20\u591A\u5F20\u53C2\u8003\u56FE\u5E76\u590D\u7528\u63D0\u793A\u8BCD\u3002\u7CFB\u7EDF\u4F1A\u6309\u6BCF\u5F20\u53C2\u8003\u56FE\u5206\u522B\u751F\u6210\u65B0\u56FE\u3002',
    },
    {
      icon: <History className="text-pink-400" size={20} />,
      title: '5. \u5386\u53F2\u8BB0\u5F55',
      content:
        '\u751F\u6210\u7684\u56FE\u7247\u548C\u89C6\u9891\u4F1A\u81EA\u52A8\u4FDD\u5B58\u3002\u652F\u6301\u9884\u89C8\u3001\u4E0B\u8F7D\u3001\u590D\u7528\u63D0\u793A\u8BCD\u4E0E\u8BBE\u4E3A\u53C2\u8003\u56FE\u3002',
    },
    {
      icon: <Film className="text-red-400" size={20} />,
      title: '6. AI \u89C6\u9891\u751F\u6210',
      content:
        '\u652F\u6301 Veo 3.1 \u4E0E Grok Video \u7CFB\u5217\u6A21\u578B\u3002Veo \u6A21\u578B\u652F\u6301\u9996\u5E27/\u5C3E\u5E27\u53C2\u8003\u53CA\u591A\u56FE\u878D\u5408\u7B49\u80FD\u529B\u3002',
    },
  ];

  return !isOpen ? null : (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-5 border-b border-gray-800 bg-gray-900/50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center">
              <HelpCircle size={18} className="text-blue-400" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white leading-tight">{'\u4F7F\u7528\u8BF4\u660E'}</h2>
              <p className="text-[10px] text-gray-500 mt-0.5">{'Nano Banana Pro \u4F7F\u7528\u6307\u5357'}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-white transition-colors p-1.5 hover:bg-gray-800 rounded-full"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5 custom-scrollbar">
          {sections.map((sec, idx) => (
            <div key={idx} className="flex gap-4 group">
              <div className="mt-1 shrink-0 p-2 bg-gray-800/50 rounded-xl border border-gray-700/50 group-hover:border-blue-500/30 transition-colors">
                {sec.icon}
              </div>
              <div className="space-y-1">
                <h3 className="text-sm font-bold text-gray-100">{sec.title}</h3>
                <p className="text-xs text-gray-400 leading-relaxed font-normal">{sec.content}</p>
              </div>
            </div>
          ))}

          <div className="mt-4 p-4 bg-blue-500/5 border border-blue-500/20 rounded-xl flex items-start gap-3">
            <CheckCircle2 size={16} className="text-blue-400 mt-0.5 shrink-0" />
            <p className="text-[11px] text-blue-300 leading-relaxed">
              {'\u63D0\u793A\uFF1A\u82E5\u4F7F\u7528\u8FC7\u7A0B\u4E2D\u9047\u5230\u95EE\u9898\uFF0C\u8BF7\u5148\u68C0\u67E5\u7F51\u7EDC\u8FDE\u63A5\u4E0E API Key \u989D\u5EA6\u3002'}
            </p>
          </div>
        </div>

        <div className="p-5 border-t border-gray-800 bg-gray-950/20">
          <button
            onClick={onClose}
            className="w-full bg-blue-600 hover:bg-blue-500 text-white text-sm font-bold py-2.5 rounded-xl transition-all shadow-lg shadow-blue-600/20 active:scale-[0.98]"
          >
            {'\u6211\u660E\u767D\u4E86'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default InstructionsModal;
