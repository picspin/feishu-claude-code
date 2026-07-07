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

export interface MagnetRect extends Point, Size {}

const DRAG_THRESHOLD_PX = 4;
const MAGNET_THRESHOLD_PX = 6;
const WINDOW_MAGNET_THRESHOLD_PX = 8;
const DOCK_MAGNET_GAP_PX = 32;
const WINDOW_MAGNET_GAP_PX = 8;

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

  return clampedPosition;
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
  magnetRects?: MagnetRect[];
  threshold?: number;
}): Point {
  const threshold = input.threshold ?? MAGNET_THRESHOLD_PX;
  const maxX = input.workArea.x + Math.max(0, input.workArea.width - input.windowSize.width);
  const maxY = input.workArea.y + Math.max(0, input.workArea.height - input.windowSize.height);
  const dockY = maxY - DOCK_MAGNET_GAP_PX;
  const xTargets = [input.workArea.x, maxX];
  const yTargets = [input.workArea.y, dockY, maxY].filter((target) => target >= input.workArea.y && target <= maxY);

  for (const rect of input.magnetRects ?? []) {
    xTargets.push(rect.x - input.windowSize.width - WINDOW_MAGNET_GAP_PX, rect.x, rect.x + rect.width + WINDOW_MAGNET_GAP_PX);
    yTargets.push(rect.y - input.windowSize.height - WINDOW_MAGNET_GAP_PX, rect.y, rect.y + rect.height + WINDOW_MAGNET_GAP_PX);
  }

  return {
    x: clamp(snapValue(input.position.x, xTargets, threshold), input.workArea.x, maxX),
    y: clamp(snapValue(input.position.y, yTargets, threshold), input.workArea.y, maxY),
  };
}

export function shouldContinueDrag(buttons: number): boolean {
  return (buttons & 1) === 1;
}

export const shouldContinueHorizontalDrag = shouldContinueDrag;

export function createPetDrag(options: { getMagnetRects?: () => Promise<MagnetRect[]> } = {}): {
  pointerDown: (event: PointerEvent) => Promise<void>;
  pointerMove: (event: PointerEvent) => Promise<void>;
  pointerUp: () => Promise<void>;
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
  let lastPosition: Point | undefined;
  let magnetRects: MagnetRect[] = [];
  let captureElement: Element | undefined;
  let capturedPointerId: number | undefined;

  async function pointerDown(event: PointerEvent): Promise<void> {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    captureElement = event.currentTarget instanceof Element ? event.currentTarget : undefined;
    capturedPointerId = event.pointerId;
    captureElement?.setPointerCapture?.(event.pointerId);
    startPointer = { x: event.clientX, y: event.clientY };
    dragging = false;
    draggedSincePointerDown = false;
    lastPosition = undefined;
    magnetRects = [];

    const [position, size, nextScaleFactor, monitor, nextMagnetRects] = await Promise.all([
      appWindow.outerPosition(),
      appWindow.outerSize(),
      appWindow.scaleFactor(),
      currentMonitor(),
      options.getMagnetRects?.().catch(() => []) ?? Promise.resolve([]),
    ]);
    startWindow = { x: position.x, y: position.y };
    windowSize = { width: size.width, height: size.height };
    scaleFactor = nextScaleFactor;
    magnetRects = nextMagnetRects;

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
      await pointerUp();
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
    lastPosition = nextPosition;
    await appWindow.setPosition(new PhysicalPosition(nextPosition.x, nextPosition.y));
  }

  async function pointerUp(): Promise<void> {
    if (dragging && lastPosition !== undefined && windowSize !== undefined && workArea !== undefined) {
      const nextPosition = snapPetToMagneticTargets({
        position: lastPosition,
        windowSize,
        workArea,
        magnetRects,
        threshold: magnetRects.length > 0 ? WINDOW_MAGNET_THRESHOLD_PX : MAGNET_THRESHOLD_PX,
      });
      if (nextPosition.x !== lastPosition.x || nextPosition.y !== lastPosition.y) {
        await appWindow.setPosition(new PhysicalPosition(nextPosition.x, nextPosition.y));
      }
    }

    startPointer = undefined;
    startWindow = undefined;
    windowSize = undefined;
    workArea = undefined;
    lastPosition = undefined;
    magnetRects = [];
    if (captureElement !== undefined && capturedPointerId !== undefined) {
      try {
        captureElement.releasePointerCapture?.(capturedPointerId);
      } catch {
        // Pointer capture can already be gone after the OS cancels a drag.
      }
    }
    captureElement = undefined;
    capturedPointerId = undefined;
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
