// TODO: copy from source

export interface DragCallbacks {
  setActiveId:    (id: string | null) => void
  setOverColonne: (col: string | null) => void
  handleDrop:     (col: string, dropIndex: number) => void
}

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
