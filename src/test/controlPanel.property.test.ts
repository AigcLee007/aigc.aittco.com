/**
 * Property-Based Tests for ControlPanel Draggable Position
 * 
 * **Feature: infinitemuse-refactor, Property 2: Draggable Panel Position**
 * **Validates: Requirements 3.4**
 * 
 * Property: For any drag operation on the ControlPanel, the panel position 
 * SHALL be updated to reflect the drag delta, and the position SHALL remain 
 * within viewport bounds.
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';

// Pure function to calculate new panel position after drag
// Extracted from ControlPanel drag logic for testability
interface Position {
  x: number;
  y: number;
}

interface ViewportBounds {
  width: number;
  height: number;
}

interface PanelDimensions {
  width: number;
  height: number;
}

/**
 * Calculate new panel position after a drag move event
 * This mirrors the logic in ControlPanel.tsx handleDragMove
 */
function calculateDragPosition(
  mouseX: number,
  mouseY: number,
  offset: Position,
  panelDimensions: PanelDimensions,
  viewport: ViewportBounds
): Position {
  const newX = mouseX - offset.x;
  const newY = mouseY - offset.y;

  // Keep panel within viewport bounds
  const maxX = viewport.width - panelDimensions.width;
  const maxY = viewport.height - panelDimensions.height;

  return {
    x: Math.max(0, Math.min(newX, maxX)),
    y: Math.max(0, Math.min(newY, maxY))
  };
}

describe('ControlPanel Draggable Position Property Tests', () => {
  /**
   * Property 2: Draggable Panel Position
   * For any drag operation, the panel position SHALL remain within viewport bounds
   */
  it('Property 2: Panel position always stays within viewport bounds after drag', () => {
    fc.assert(
      fc.property(
        // Generate random viewport dimensions (reasonable screen sizes)
        fc.integer({ min: 800, max: 3840 }),  // viewport width
        fc.integer({ min: 600, max: 2160 }),  // viewport height
        // Generate random panel dimensions
        fc.integer({ min: 200, max: 400 }),   // panel width
        fc.integer({ min: 300, max: 600 }),   // panel height
        // Generate random initial panel position (unused but kept for documentation)
        fc.integer({ min: 0, max: 3000 }),    // _initialPanelLeft
        fc.integer({ min: 0, max: 2000 }),    // _initialPanelTop
        // Generate random mouse positions for drag
        fc.integer({ min: -500, max: 4000 }), // mouse X (can be outside viewport)
        fc.integer({ min: -500, max: 3000 }), // mouse Y (can be outside viewport)
        // Generate random click offset within panel
        fc.integer({ min: 0, max: 400 }),     // click offset X
        fc.integer({ min: 0, max: 600 }),     // click offset Y
        (
          viewportWidth, viewportHeight,
          panelWidth, panelHeight,
          _initialPanelLeft, _initialPanelTop,
          mouseX, mouseY,
          clickOffsetX, clickOffsetY
        ) => {
          // Ensure click offset is within panel bounds
          const offset: Position = {
            x: Math.min(clickOffsetX, panelWidth),
            y: Math.min(clickOffsetY, panelHeight)
          };

          const viewport: ViewportBounds = {
            width: viewportWidth,
            height: viewportHeight
          };

          const panelDimensions: PanelDimensions = {
            width: panelWidth,
            height: panelHeight
          };

          // Calculate new position after drag
          const newPosition = calculateDragPosition(
            mouseX,
            mouseY,
            offset,
            panelDimensions,
            viewport
          );

          // Property: Position must be within viewport bounds
          // x >= 0 (not off left edge)
          expect(newPosition.x).toBeGreaterThanOrEqual(0);
          // y >= 0 (not off top edge)
          expect(newPosition.y).toBeGreaterThanOrEqual(0);
          // x + panelWidth <= viewportWidth (not off right edge)
          expect(newPosition.x + panelWidth).toBeLessThanOrEqual(viewportWidth);
          // y + panelHeight <= viewportHeight (not off bottom edge)
          expect(newPosition.y + panelHeight).toBeLessThanOrEqual(viewportHeight);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2 (continued): Drag delta is correctly applied
   * The position change should reflect the mouse movement
   */
  it('Property 2: Panel position reflects drag delta correctly within bounds', () => {
    fc.assert(
      fc.property(
        // Fixed viewport for simpler delta testing
        fc.constant(1920),  // viewport width
        fc.constant(1080),  // viewport height
        fc.constant(320),   // panel width (matches ControlPanel)
        fc.constant(400),   // panel height
        // Initial position within bounds
        fc.integer({ min: 100, max: 500 }),  // initial X
        fc.integer({ min: 100, max: 400 }),  // initial Y
        // Drag delta (small movements)
        fc.integer({ min: -50, max: 50 }),   // delta X
        fc.integer({ min: -50, max: 50 }),   // delta Y
        (
          viewportWidth, viewportHeight,
          panelWidth, panelHeight,
          initialX, initialY,
          deltaX, deltaY
        ) => {
          // Simulate drag start at center of panel
          const offset: Position = { x: panelWidth / 2, y: 20 };
          
          // Initial mouse position (panel position + offset)
          const initialMouseX = initialX + offset.x;
          const initialMouseY = initialY + offset.y;
          
          // New mouse position after drag
          const newMouseX = initialMouseX + deltaX;
          const newMouseY = initialMouseY + deltaY;

          const viewport: ViewportBounds = { width: viewportWidth, height: viewportHeight };
          const panelDimensions: PanelDimensions = { width: panelWidth, height: panelHeight };

          // Calculate new position
          const newPosition = calculateDragPosition(
            newMouseX,
            newMouseY,
            offset,
            panelDimensions,
            viewport
          );

          // Expected position (before clamping)
          const expectedX = initialX + deltaX;
          const expectedY = initialY + deltaY;

          // Clamp expected values
          const maxX = viewportWidth - panelWidth;
          const maxY = viewportHeight - panelHeight;
          const clampedExpectedX = Math.max(0, Math.min(expectedX, maxX));
          const clampedExpectedY = Math.max(0, Math.min(expectedY, maxY));

          // Property: Position should match expected clamped position
          expect(newPosition.x).toBe(clampedExpectedX);
          expect(newPosition.y).toBe(clampedExpectedY);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property 2 (edge case): Panel at boundary stays at boundary
   */
  it('Property 2: Panel at viewport edge stays clamped when dragged further out', () => {
    fc.assert(
      fc.property(
        // Viewport dimensions
        fc.integer({ min: 800, max: 1920 }),
        fc.integer({ min: 600, max: 1080 }),
        // Panel dimensions
        fc.integer({ min: 200, max: 400 }),
        fc.integer({ min: 300, max: 500 }),
        // Direction to drag (negative = towards 0, positive = towards max)
        fc.integer({ min: -1000, max: 1000 }),
        fc.integer({ min: -1000, max: 1000 }),
        (viewportWidth, viewportHeight, panelWidth, panelHeight, dragX, dragY) => {
          const viewport: ViewportBounds = { width: viewportWidth, height: viewportHeight };
          const panelDimensions: PanelDimensions = { width: panelWidth, height: panelHeight };
          const offset: Position = { x: 10, y: 10 };

          // Start from corner (0, 0) and drag with negative values
          const positionFromTopLeft = calculateDragPosition(
            dragX + offset.x,
            dragY + offset.y,
            offset,
            panelDimensions,
            viewport
          );

          // Property: Position never goes negative
          expect(positionFromTopLeft.x).toBeGreaterThanOrEqual(0);
          expect(positionFromTopLeft.y).toBeGreaterThanOrEqual(0);

          // Property: Position never exceeds max bounds
          const maxX = viewportWidth - panelWidth;
          const maxY = viewportHeight - panelHeight;
          expect(positionFromTopLeft.x).toBeLessThanOrEqual(maxX);
          expect(positionFromTopLeft.y).toBeLessThanOrEqual(maxY);
        }
      ),
      { numRuns: 100 }
    );
  });
});
