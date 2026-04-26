import { Stroke } from '../../types';

// ==================== 即梦/Z-image 分辨率映射表 ====================
// 即梦4.5支持2K/4K，即梦5.0支持2K/3K，z-image-turbo支持1K/2K/4K
// 需要将 size+aspect_ratio 转换为精确的 WxH 像素值
export const DOUBAO_RESOLUTIONS: Record<string, Record<string, string>> = {
  "1k": {
    "1:1": "1024x1024", "4:3": "1152x864", "3:4": "864x1152", "16:9": "1424x800",
    "9:16": "800x1424", "3:2": "1248x832", "2:3": "832x1248", "21:9": "1568x672"
  },
  "2k": {
    "1:1": "2048x2048", "4:3": "2304x1728", "3:4": "1728x2304", "16:9": "2848x1600",
    "9:16": "1600x2848", "3:2": "2496x1664", "2:3": "1664x2496", "21:9": "3136x1344"
  },
  "3k": {
    "1:1": "3072x3072", "4:3": "3456x2592", "3:4": "2592x3456", "16:9": "4096x2304",
    "9:16": "2304x4096", "2:3": "2496x3744", "3:2": "3744x2496", "21:9": "4704x2016"
  },
  "4k": {
    "1:1": "4096x4096", "4:3": "4704x3520", "3:4": "3520x4704", "16:9": "5504x3040",
    "9:16": "3040x5504", "2:3": "3328x4992", "3:2": "4992x3328", "21:9": "6240x2656"
  }
};

/** 根据模型、尺寸和宽高比，返回即梦所需的精确 WxH 像素值 */
export const getDoubaoSize = (model: string, size: string, ratio: string): string => {
  const sizeKey = size.toLowerCase();
  const resMap = DOUBAO_RESOLUTIONS[sizeKey] || DOUBAO_RESOLUTIONS["2k"];

  // 精确匹配
  if (resMap[ratio]) {
    return resMap[ratio];
  }

  // 未匹配到的比例（如 9:21, 5:4, Custom），计算最接近的已支持比例
  const parts = ratio.split(':').map(Number);
  if (parts.length === 2 && parts[0] > 0 && parts[1] > 0) {
    const targetRatio = parts[0] / parts[1];
    let bestKey = "1:1";
    let bestDiff = Infinity;
    for (const key of Object.keys(resMap)) {
      const kp = key.split(':').map(Number);
      const diff = Math.abs(kp[0] / kp[1] - targetRatio);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestKey = key;
      }
    }
    return resMap[bestKey];
  }

  // 最终 fallback
  return resMap["1:1"];
};

const GPT_SIZE_PATTERN = /^\s*(\d+)\s*[xX×]\s*(\d+)\s*$/;
const GPT_RATIO_PATTERN = /^\s*(\d+(?:\.\d+)?)\s*[:xX×]\s*(\d+(?:\.\d+)?)\s*$/;

const roundToMultiple = (value: number, multiple: number): number =>
  Math.max(multiple, Math.round(value / multiple) * multiple);

export const normalizeGptImageSize = (size: string): string => {
  const trimmed = String(size || '').trim();
  const match = trimmed.match(GPT_SIZE_PATTERN);
  if (!match) return trimmed;

  const width = roundToMultiple(Number(match[1]), 16);
  const height = roundToMultiple(Number(match[2]), 16);
  return `${width}x${height}`;
};

const parseGptRatio = (ratio: string): { width: number; height: number } | null => {
  const match = String(ratio || '').match(GPT_RATIO_PATTERN);
  if (!match) return null;

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null;
  }

  return { width, height };
};

export const calculateGptImageSize = (size: string, ratio: string): string => {
  const normalizedSize = String(size || '').toLowerCase();
  if (normalizedSize === 'auto') return 'auto';
  if (GPT_SIZE_PATTERN.test(normalizedSize)) return normalizeGptImageSize(normalizedSize);

  const tier = normalizedSize === '4k' ? '4k' : normalizedSize === '2k' ? '2k' : '1k';
  const parsedRatio = parseGptRatio(ratio) || { width: 1, height: 1 };
  const { width: ratioWidth, height: ratioHeight } = parsedRatio;

  if (ratioWidth === ratioHeight) {
    const side = tier === '1k' ? 1024 : tier === '2k' ? 2048 : 3840;
    return `${side}x${side}`;
  }

  if (tier === '1k') {
    const shortSide = 1024;
    const width = ratioWidth > ratioHeight
      ? roundToMultiple((shortSide * ratioWidth) / ratioHeight, 16)
      : shortSide;
    const height = ratioWidth > ratioHeight
      ? shortSide
      : roundToMultiple((shortSide * ratioHeight) / ratioWidth, 16);
    return `${width}x${height}`;
  }

  const longSide = tier === '2k' ? 2048 : 3840;
  const width = ratioWidth > ratioHeight
    ? longSide
    : roundToMultiple((longSide * ratioWidth) / ratioHeight, 16);
  const height = ratioWidth > ratioHeight
    ? roundToMultiple((longSide * ratioHeight) / ratioWidth, 16)
    : longSide;
  return `${width}x${height}`;
};

export const findClosestRatio = (r: number): string => {
  const ratios: { [key: string]: number } = { '1:1': 1, '16:9': 16 / 9, '9:16': 9 / 16, '4:3': 4 / 3, '3:4': 3 / 4, '3:2': 3 / 2, '2:3': 2 / 3, '21:9': 21 / 9, '9:21': 9 / 21, '5:4': 5 / 4 };
  let closest = '1:1';
  let minDiff = Infinity;
  Object.entries(ratios).forEach(([key, val]) => {
    const diff = Math.abs(r - val);
    if (diff < minDiff) { minDiff = diff; closest = key; }
  });
  return closest;
};

export const extractRatioFromPrompt = (text: string): string | null => {
  const match = text.match(/(?:--ar\s+|)(\d+)\s*[:\uff1a]\s*(\d+)/i);
  if (match) {
    const w = parseInt(match[1]);
    const h = parseInt(match[2]);
    if (w > 0 && h > 0) return findClosestRatio(w / h);
  }
  return null;
};

/**
 * 将笔触渲染为带透明通道的 PNG。
 * - 如果提供了 sourceImage，则会将原图画在底层，然后将涂抹区域“挖除”成完全透明（Alpha=0）。
 * - 如果未提供，则生成纯黑底色 + 透明洞的单张遮罩图。
 * - width / height: 遮罩最终输出的真实像素大小（即原图大小）
 * - displayWidth / displayHeight: 画布上显示该图片的视觉大小
 */
export const renderMaskToDataURL = (
    sourceImage: HTMLImageElement | null, 
    width: number, 
    height: number, 
    displayWidth: number, 
    displayHeight: number, 
    strokes: Stroke[],
    asBlackAndWhite: boolean = false
): string => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    // 1. 底图层：画原图或者画纯黑
    if (sourceImage) {
        ctx.drawImage(sourceImage, 0, 0, width, height);
    } else {
        // 填充黑色，Alpha=1
        ctx.fillStyle = 'rgba(0, 0, 0, 1)';
        ctx.fillRect(0, 0, width, height);
    }

    // 2. 将画笔模式改为 destination-out：接下来画的所有东西，会将下方已有图层对应位置的 Alpha 值扣除变成完全透明 (如果需要黑白遮罩则不用)
    if (!asBlackAndWhite) {
        ctx.globalCompositeOperation = 'destination-out';
    } else {
        ctx.globalCompositeOperation = 'source-over';
    }
    
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const scaleX = width / displayWidth;
    const scaleY = height / displayHeight;
    const avgScale = (scaleX + scaleY) / 2;

    strokes.forEach(stroke => {
        if (stroke.points.length === 0) return;
        ctx.beginPath();
        ctx.lineWidth = stroke.size * avgScale;
        
        ctx.strokeStyle = 'rgba(255, 255, 255, 1)'; 
        
        ctx.moveTo(stroke.points[0].x * scaleX, stroke.points[0].y * scaleY);
        for (let i = 1; i < stroke.points.length; i++) {
            ctx.lineTo(stroke.points[i].x * scaleX, stroke.points[i].y * scaleY);
        }
        ctx.stroke();
    });

    // 恢复正常混合模式
    ctx.globalCompositeOperation = 'source-over';

    return canvas.toDataURL('image/png');
};

/**
 * 将图片 URL（包括 blob URL 和普通 URL）转换为 Base64
 */
export const getBase64FromUrl = async (url: string): Promise<string> => {
    if (url.startsWith('data:')) {
        return url;
    }
    try {
        const response = await fetch(url);
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                if (typeof reader.result === 'string') {
                    resolve(reader.result);
                } else {
                    reject(new Error("Failed to convert blob to base64"));
                }
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        console.error("Error converting URL to Base64:", error);
        throw error;
    }
};
