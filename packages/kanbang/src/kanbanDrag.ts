// TODO: copy from source
import type { DragCallbacks } from './kanbanDrag'

export type { DragCallbacks }

export declare function onCardPointerDown(
  e: PointerEvent,
  id: string,
  callbacks: DragCallbacks,
): void

export declare function applyStoredOrder<T>(
  items: T[],
  getId: (item: T) => string,
  storedIds: string[],
  isPrio?: (item: T) => boolean,
): T[]
