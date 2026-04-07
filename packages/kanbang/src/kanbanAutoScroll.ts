import { getConfig } from './kanbanDragConfig'

// ── Config ──

const ZONE   = 80   // px from edge where scrolling kicks in
const MAX_PX = 14   // max px scrolled per frame

// ── State ──

let rafId:  number | null = null
let velX = 0   // horizontal velocity (board)
let velY = 0   // vertical velocity (window)
let boardEl: HTMLElement | null = null

// ── Helpers ──

/** Quadratic ease: faster the closer to the edge. Returns 0 if outside zone. */
function velocity(distToEdge: number): number {
  if (distToEdge >= ZONE) return 0
  const ratio = 1 - distToEdge / ZONE
  return MAX_PX * ratio * ratio
}

function tick() {
  const { classes } = getConfig()
  if (velX === 0 && velY === 0) {
    rafId = null
    boardEl?.classList.remove(classes.boardScrolling)
    return
  }
  if (boardEl && velX !== 0) boardEl.scrollLeft += velX
  if (velY !== 0) window.scrollBy(0, velY)
  rafId = requestAnimationFrame(tick)
}

// ── Public API ──

/**
 * Call on every pointermove while a card is being dragged.
 * Computes scroll velocity from pointer proximity to board/window edges and starts
 * the rAF loop if needed.
 */
export function updateAutoScroll(x: number, y: number): void {
  const { selectors, classes } = getConfig()
  if (!boardEl) boardEl = document.querySelector<HTMLElement>(selectors.board)

  velX = 0
  velY = 0

  if (boardEl) {
    const r = boardEl.getBoundingClientRect()
    if (x < r.left + ZONE)  velX = -velocity(x - r.left)
    else if (x > r.right - ZONE) velX =  velocity(r.right - x)
  }

  if (y < ZONE)                      velY = -velocity(y)
  else if (y > window.innerHeight - ZONE) velY =  velocity(window.innerHeight - y)

  if ((velX !== 0 || velY !== 0) && rafId === null) {
    boardEl?.classList.add(classes.boardScrolling)
    rafId = requestAnimationFrame(tick)
  }
}

/**
 * Call when the drag ends (drop or cancel). Stops all scrolling immediately.
 */
export function stopAutoScroll(): void {
  const { classes } = getConfig()
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null }
  velX = 0
  velY = 0
  boardEl?.classList.remove(classes.boardScrolling)
  boardEl = null
}
