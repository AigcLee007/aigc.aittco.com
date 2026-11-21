import { describe, expect, it } from 'vitest';
import { findCanvasFreePositions } from './canvasPlacement';

describe('findCanvasFreePositions', () => {
  it('uses the anchor when the requested rectangle is clear', () => {
    expect(
      findCanvasFreePositions([], [{ width: 100, height: 80 }], { x: 12, y: 24 }, 20),
    ).toEqual([{ x: 12, y: 24 }]);
  });

  it('moves a new rectangle to the first clear spiral position', () => {
    const occupied = [{ x: 0, y: 0, width: 100, height: 80 }];

    expect(
      findCanvasFreePositions(occupied, [{ width: 100, height: 80 }], { x: 0, y: 0 }, 20),
    ).toEqual([{ x: 120, y: 0 }]);
    expect(occupied).toEqual([{ x: 0, y: 0, width: 100, height: 80 }]);
  });

  it('reserves non-overlapping positions for mixed-size outputs in request order', () => {
    const sizes = [
      { width: 100, height: 80 },
      { width: 60, height: 120 },
      { width: 140, height: 70 },
      { width: 90, height: 90 },
    ];

    const first = findCanvasFreePositions(
      [{ x: -50, y: -40, width: 100, height: 80 }],
      sizes,
      { x: 0, y: 0 },
      20,
    );
    const second = findCanvasFreePositions(
      [{ x: -50, y: -40, width: 100, height: 80 }],
      sizes,
      { x: 0, y: 0 },
      20,
    );

    expect(first).toEqual(second);
    expect(first).toHaveLength(sizes.length);

    const rectangles = first.map((position, index) => ({ ...position, ...sizes[index] }));
    for (let left = 0; left < rectangles.length; left += 1) {
      for (let right = left + 1; right < rectangles.length; right += 1) {
        const firstRect = rectangles[left];
        const secondRect = rectangles[right];
        const separated =
          firstRect.x + firstRect.width + 20 <= secondRect.x ||
          secondRect.x + secondRect.width + 20 <= firstRect.x ||
          firstRect.y + firstRect.height + 20 <= secondRect.y ||
          secondRect.y + secondRect.height + 20 <= firstRect.y;

        expect(separated).toBe(true);
      }
    }
  });

  it('rejects invalid sizes and gaps', () => {
    expect(() => findCanvasFreePositions([], [{ width: 0, height: 80 }], { x: 0, y: 0 })).toThrow(RangeError);
    expect(() => findCanvasFreePositions([], [{ width: 80, height: 80 }], { x: 0, y: 0 }, -1)).toThrow(RangeError);
  });
});
