// The canvas no longer fills the window: the control sidebar takes a strip on the left. Anything that
// means "the middle of what the user can see", or turns a screen position into a canvas position,
// has to use this rectangle instead of the window.

export interface CanvasViewport { left: number; top: number; width: number; height: number }

export const CANVAS_VIEWPORT_ATTRIBUTE = 'data-canvas-viewport';

export const getCanvasViewport = (): CanvasViewport => {
  if (typeof document !== 'undefined') {
    const element = document.querySelector<HTMLElement>(`[${CANVAS_VIEWPORT_ATTRIBUTE}]`);
    if (element) {
      const box = element.getBoundingClientRect();
      if (box.width > 0 && box.height > 0) return { left: box.left, top: box.top, width: box.width, height: box.height };
    }
  }
  const width = typeof window !== 'undefined' ? window.innerWidth : 1000;
  const height = typeof window !== 'undefined' ? window.innerHeight : 800;
  return { left: 0, top: 0, width, height };
};

// Before the sidebar exists (first render, tests) this is the width the canvas will have, so a fresh
// canvas is centred where the user will see it.
export const defaultSidebarInset = (windowWidth: number): number => (windowWidth < 640 ? 0 : windowWidth < 900 ? 52 : 360);

// Centre of the canvas in stage coordinates (the stage starts at the canvas element's left edge).
export const getCanvasCenter = (): { x: number; y: number } => {
  const viewport = getCanvasViewport();
  return { x: viewport.width / 2, y: viewport.height / 2 };
};

// A point in the browser window (clientX / clientY) as a point on the stage.
export const clientToStage = (point: { x: number; y: number }): { x: number; y: number } => {
  const viewport = getCanvasViewport();
  return { x: point.x - viewport.left, y: point.y - viewport.top };
};
