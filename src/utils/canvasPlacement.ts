import type { Point } from '../../types';

export interface CanvasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CanvasSize {
  width: number;
  height: number;
}

function* spiralOffsets(): Generator<Point> {
  let x = 0;
  let y = 0;
  let stepLength = 1;

  yield { x, y };

  while (true) {
    for (let step = 0; step < stepLength; step += 1) {
      x += 1;
      yield { x, y };
    }
    for (let step = 0; step < stepLength; step += 1) {
      y += 1;
      yield { x, y };
    }
    stepLength += 1;

    for (let step = 0; step < stepLength; step += 1) {
      x -= 1;
      yield { x, y };
    }
    for (let step = 0; step < stepLength; step += 1) {
      y -= 1;
      yield { x, y };
    }
    stepLength += 1;
  }
}

const intersectsWithGap = (left: CanvasRect, right: CanvasRect, gap: number) =>
  left.x < right.x + right.width + gap &&
  left.x + left.width + gap > right.x &&
  left.y < right.y + right.height + gap &&
  left.y + left.height + gap > right.y;

function validateSize(size: CanvasSize) {
  if (
    !Number.isFinite(size.width) ||
    !Number.isFinite(size.height) ||
    size.width <= 0 ||
    size.height <= 0
  ) {
    throw new RangeError('Canvas placement sizes must be positive finite numbers');
  }
}

export function findCanvasFreePositions(
  occupied: CanvasRect[],
  requested: CanvasSize[],
  anchor: Point,
  gap = 20,
): Point[] {
  if (!Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) {
    throw new RangeError('Canvas placement anchor must be finite');
  }
  if (!Number.isFinite(gap) || gap < 0) {
    throw new RangeError('Canvas placement gap must be a non-negative finite number');
  }

  requested.forEach(validateSize);
  const allocated: CanvasRect[] = [];

  for (const size of requested) {
    const candidatePositions = spiralOffsets();
    let placement: Point | undefined;

    for (const offset of candidatePositions) {
      const candidate = {
        x: anchor.x + offset.x * (size.width + gap),
        y: anchor.y + offset.y * (size.height + gap),
        ...size,
      };

      if (!occupied.some((rect) => intersectsWithGap(candidate, rect, gap)) &&
        !allocated.some((rect) => intersectsWithGap(candidate, rect, gap))) {
        placement = { x: candidate.x, y: candidate.y };
        allocated.push(candidate);
        break;
      }
    }

    if (!placement) throw new Error('Canvas placement search exhausted');
  }

  return allocated.map(({ x, y }) => ({ x, y }));
}
