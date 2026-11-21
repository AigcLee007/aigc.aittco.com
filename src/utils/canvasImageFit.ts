export interface ImageFrameFit {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FramePoint {
  x: number;
  y: number;
}

export function fitImageInFrame(
  imageWidth: number,
  imageHeight: number,
  frameWidth: number,
  frameHeight: number,
): ImageFrameFit {
  if (
    !Number.isFinite(imageWidth) ||
    !Number.isFinite(imageHeight) ||
    !Number.isFinite(frameWidth) ||
    !Number.isFinite(frameHeight) ||
    imageWidth <= 0 ||
    imageHeight <= 0 ||
    frameWidth <= 0 ||
    frameHeight <= 0
  ) {
    throw new RangeError('Image and frame dimensions must be positive finite numbers');
  }

  const scale = Math.min(frameWidth / imageWidth, frameHeight / imageHeight);
  const width = imageWidth * scale;
  const height = imageHeight * scale;

  return {
    x: (frameWidth - width) / 2,
    y: (frameHeight - height) / 2,
    width,
    height,
  };
}

export function isPointInImageFrame(point: FramePoint, fit: ImageFrameFit): boolean {
  return point.x >= fit.x && point.x <= fit.x + fit.width &&
    point.y >= fit.y && point.y <= fit.y + fit.height;
}

export function framePointToImagePoint(point: FramePoint, fit: ImageFrameFit): FramePoint {
  return { x: point.x - fit.x, y: point.y - fit.y };
}
