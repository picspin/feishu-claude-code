import { PhysicalPosition } from '@tauri-apps/api/dpi';
import { currentMonitor, getCurrentWindow } from '@tauri-apps/api/window';

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface WorkArea extends Point, Size {}

const DRAG_THRESHOLD_PX = 4;

export function clampHorizontalDockDrag(input: {
  startWindow: Point;
  pointerDeltaX: number;
  scaleFactor: number;
  windowSize: Size;
  workArea: WorkArea;
}): Point {
  const deltaX = Math.round(input.pointerDeltaX * input.scaleFactor);
  const minX = input.workArea.x;
  const maxX = input.workArea.x + Math.max(0, input.workArea.width - input.windowSize.width);
  return {
    x: clamp(input.startWindow.x + deltaX, minX, maxX),
    y: input.startWindow.y,
  };
}

export function shouldContinueHorizontalDrag(buttons: number): boolean {
  return (buttons & 1) === 1;
}

export function createHorizontalPetDrag(): {
  pointerDown: (event: PointerEvent) => Promise<void>;
  pointerMove: (event: PointerEvent) => Promise<void>;
  pointerUp: () => void;
  consumeDragClick: () => boolean;
} {
  const appWindow = getCurrentWindow();
  let startPointerX: number | undefined;
  let startWindow: Point | undefined;
  let windowSize: Size | undefined;
  let workArea: WorkArea | undefined;
  let scaleFactor = 1;
  let dragging = false;
  let draggedSincePointerDown = false;

  async function pointerDown(event: PointerEvent): Promise<void> {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    startPointerX = event.clientX;
    dragging = false;
    draggedSincePointerDown = false;

    const [position, size, nextScaleFactor, monitor] = await Promise.all([
      appWindow.outerPosition(),
      appWindow.outerSize(),
      appWindow.scaleFactor(),
      currentMonitor(),
    ]);
    startWindow = { x: position.x, y: position.y };
    windowSize = { width: size.width, height: size.height };
    scaleFactor = nextScaleFactor;

    const area = monitor?.workArea;
    workArea = area
      ? {
          x: area.position.x,
          y: area.position.y,
          width: area.size.width,
          height: area.size.height,
        }
      : undefined;
  }

  async function pointerMove(event: PointerEvent): Promise<void> {
    if (!shouldContinueHorizontalDrag(event.buttons)) {
      pointerUp();
      return;
    }

    if (
      startPointerX === undefined ||
      startWindow === undefined ||
      windowSize === undefined ||
      workArea === undefined
    ) {
      return;
    }

    const pointerDeltaX = event.clientX - startPointerX;
    if (!dragging && Math.abs(pointerDeltaX) < DRAG_THRESHOLD_PX) {
      return;
    }

    dragging = true;
    draggedSincePointerDown = true;
    const nextPosition = clampHorizontalDockDrag({
      startWindow,
      pointerDeltaX,
      scaleFactor,
      windowSize,
      workArea,
    });
    await appWindow.setPosition(new PhysicalPosition(nextPosition.x, nextPosition.y));
  }

  function pointerUp(): void {
    startPointerX = undefined;
    startWindow = undefined;
    windowSize = undefined;
    workArea = undefined;
    dragging = false;
  }

  function consumeDragClick(): boolean {
    const shouldConsume = draggedSincePointerDown;
    draggedSincePointerDown = false;
    return shouldConsume;
  }

  return { pointerDown, pointerMove, pointerUp, consumeDragClick };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
