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
const MAGNET_THRESHOLD_PX = 28;
const DOCK_MAGNET_GAP_PX = 32;

export function clampPetDrag(input: {
  startWindow: Point;
  pointerDelta: Point;
  scaleFactor: number;
  windowSize: Size;
  workArea: WorkArea;
}): Point {
  const deltaX = Math.round(input.pointerDelta.x * input.scaleFactor);
  const deltaY = Math.round(input.pointerDelta.y * input.scaleFactor);
  const minX = input.workArea.x;
  const maxX = input.workArea.x + Math.max(0, input.workArea.width - input.windowSize.width);
  const minY = input.workArea.y;
  const maxY = input.workArea.y + Math.max(0, input.workArea.height - input.windowSize.height);
  const clampedPosition = {
    x: clamp(input.startWindow.x + deltaX, minX, maxX),
    y: clamp(input.startWindow.y + deltaY, minY, maxY),
  };

  return snapPetToMagneticTargets({
    position: clampedPosition,
    windowSize: input.windowSize,
    workArea: input.workArea,
    threshold: MAGNET_THRESHOLD_PX,
  });
}

export function clampHorizontalDockDrag(input: {
  startWindow: Point;
  pointerDeltaX: number;
  scaleFactor: number;
  windowSize: Size;
  workArea: WorkArea;
}): Point {
  return clampPetDrag({
    startWindow: input.startWindow,
    pointerDelta: { x: input.pointerDeltaX, y: 0 },
    scaleFactor: input.scaleFactor,
    windowSize: input.windowSize,
    workArea: input.workArea,
  });
}

export function snapPetToMagneticTargets(input: {
  position: Point;
  windowSize: Size;
  workArea: WorkArea;
  threshold?: number;
}): Point {
  const threshold = input.threshold ?? MAGNET_THRESHOLD_PX;
  const maxX = input.workArea.x + Math.max(0, input.workArea.width - input.windowSize.width);
  const maxY = input.workArea.y + Math.max(0, input.workArea.height - input.windowSize.height);
  const dockY = maxY - DOCK_MAGNET_GAP_PX;

  return {
    x: snapValue(input.position.x, [input.workArea.x, maxX], threshold),
    y: snapValue(
      input.position.y,
      [input.workArea.y, dockY, maxY].filter((target) => target >= input.workArea.y && target <= maxY),
      threshold,
    ),
  };
}

export function shouldContinueDrag(buttons: number): boolean {
  return (buttons & 1) === 1;
}

export const shouldContinueHorizontalDrag = shouldContinueDrag;

export function createPetDrag(): {
  pointerDown: (event: PointerEvent) => Promise<void>;
  pointerMove: (event: PointerEvent) => Promise<void>;
  pointerUp: () => void;
  consumeDragClick: () => boolean;
} {
  const appWindow = getCurrentWindow();
  let startPointer: Point | undefined;
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
    startPointer = { x: event.clientX, y: event.clientY };
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
    if (!shouldContinueDrag(event.buttons)) {
      pointerUp();
      return;
    }

    if (
      startPointer === undefined ||
      startWindow === undefined ||
      windowSize === undefined ||
      workArea === undefined
    ) {
      return;
    }

    const pointerDelta = { x: event.clientX - startPointer.x, y: event.clientY - startPointer.y };
    if (!dragging && Math.hypot(pointerDelta.x, pointerDelta.y) < DRAG_THRESHOLD_PX) {
      return;
    }

    dragging = true;
    draggedSincePointerDown = true;
    const nextPosition = clampPetDrag({
      startWindow,
      pointerDelta,
      scaleFactor,
      windowSize,
      workArea,
    });
    await appWindow.setPosition(new PhysicalPosition(nextPosition.x, nextPosition.y));
  }

  function pointerUp(): void {
    startPointer = undefined;
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

export const createHorizontalPetDrag = createPetDrag;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function snapValue(value: number, targets: number[], threshold: number): number {
  let nearestValue = value;
  let nearestDistance = threshold + 1;
  for (const target of targets) {
    const distance = Math.abs(value - target);
    if (distance <= threshold && distance < nearestDistance) {
      nearestValue = target;
      nearestDistance = distance;
    }
  }
  return nearestValue;
}
