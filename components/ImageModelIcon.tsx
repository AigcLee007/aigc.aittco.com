import React from 'react';
import { Banana, Layers, Sparkles, Zap } from 'lucide-react';
import type { ImageModelIconKind } from '../src/config/imageModels';

interface ImageModelIconProps {
  iconKind?: ImageModelIconKind;
  line?: string;
  variant?: 'selector' | 'title';
}

export const ImageModelIcon: React.FC<ImageModelIconProps> = ({
  iconKind = 'banana',
  line,
  variant = 'selector',
}) => {
  const isTitle = variant === 'title';
  const mainSize = isTitle ? 20 : 12;
  const accentSize = isTitle ? 14 : 12;

  switch (iconKind) {
    case 'banana-zap':
      return (
        <div className="flex items-center gap-0.5">
          <Banana size={mainSize} className="text-yellow-400" />
          <Zap size={accentSize} className="text-yellow-400" />
        </div>
      );
    case 'sparkles':
      return (
        <Sparkles
          size={mainSize}
          className={isTitle ? 'text-purple-400 drop-shadow-[0_0_8px_rgba(168,85,247,0.5)]' : 'text-purple-400'}
        />
      );
    case 'layers':
      return (
        <Layers
          size={mainSize}
          className={isTitle ? 'text-blue-400 drop-shadow-[0_0_8px_rgba(96,165,250,0.5)]' : 'text-blue-400'}
        />
      );
    case 'zap':
      return (
        <Zap
          size={mainSize}
          className={isTitle ? 'text-blue-400 drop-shadow-[0_0_8px_rgba(96,165,250,0.5)]' : 'text-blue-400'}
        />
      );
    case 'none':
      return null;
    case 'banana':
    default:
      if (isTitle && (line === 'line2' || line === 'line3')) {
        return (
          <div className="flex items-center gap-0.5 drop-shadow-[0_0_8px_rgba(250,204,21,0.5)] transform -rotate-12">
            <Banana size={mainSize} className="text-yellow-400" />
            <Sparkles
              size={accentSize}
              className={
                line === 'line2'
                  ? 'text-yellow-400 ml-[-8px] mt-[-8px]'
                  : 'text-orange-400 ml-[-8px] mt-[-8px]'
              }
            />
          </div>
        );
      }

      if (!isTitle) {
        return <Banana size={mainSize} className="text-yellow-400" />;
      }

      return (
        <Banana
          size={mainSize}
          className="text-yellow-400 drop-shadow-[0_0_8px_rgba(250,204,21,0.5)] transform -rotate-12"
        />
      );
  }
};

export default ImageModelIcon;
