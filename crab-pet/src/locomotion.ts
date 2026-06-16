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

export type CrawlDirection = -1 | 1;

const CRAWL_SPEED_PX_PER_SEC = 16;
const CRAWL_TICK_MS = 250;

export function nextCrawlStep(input: {
  position: Point;
  direction: CrawlDirection;
  elapsedMs: number;
  speedPxPerSec: number;
  windowSize: Size;
  workArea: WorkArea;
}): { position: Point; direction: CrawlDirection } {
  const minX = input.workArea.x;
  const maxX = input.workArea.x + Math.max(0, input.workArea.width - input.windowSize.width);
  const deltaX = Math.round((input.speedPxPerSec * input.elapsedMs) / 1_000) * input.direction;
  const proposedX = input.position.x + deltaX;

  if (proposedX <= minX) {
    return { position: { x: minX, y: input.position.y }, direction: 1 };
  }
  if (proposedX >= maxX) {
    return { position: { x: maxX, y: input.position.y }, direction: -1 };
  }

  return { position: { x: proposedX, y: input.position.y }, direction: input.direction };
}

export function createCrawlLocomotion(): {
  setActive: (active: boolean) => void;
  stop: () => void;
} {
  const appWindow = getCurrentWindow();
  let timer: number | undefined;
  let direction: CrawlDirection = 1;
  let lastTickMs = Date.now();
  let moving = false;

  function setActive(active: boolean): void {
    if (!active) {
      stop();
      return;
    }
    if (timer !== undefined) {
      return;
    }
    lastTickMs = Date.now();
    timer = window.setInterval(() => {
      void tick().catch(() => undefined);
    }, CRAWL_TICK_MS);
  }

  function stop(): void {
    if (timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
    moving = false;
  }

  async function tick(): Promise<void> {
    if (moving) {
      return;
    }
    moving = true;
    try {
      const nowMs = Date.now();
      const elapsedMs = nowMs - lastTickMs;
      lastTickMs = nowMs;
      const [position, size, monitor] = await Promise.all([
        appWindow.outerPosition(),
        appWindow.outerSize(),
        currentMonitor(),
      ]);
      const area = monitor?.workArea;
      if (!area) {
        return;
      }
      const next = nextCrawlStep({
        position: { x: position.x, y: position.y },
        direction,
        elapsedMs,
        speedPxPerSec: CRAWL_SPEED_PX_PER_SEC,
        windowSize: { width: size.width, height: size.height },
        workArea: {
          x: area.position.x,
          y: area.position.y,
          width: area.size.width,
          height: area.size.height,
        },
      });
      direction = next.direction;
      await appWindow.setPosition(new PhysicalPosition(next.position.x, next.position.y));
    } finally {
      moving = false;
    }
  }

  return { setActive, stop };
}
