import { updateAutoScroll, stopAutoScroll } from './kanbanAutoScroll'
import { getConfig } from './kanbanDragConfig'

// ── Types ──

export interface DragCallbacks {
  setActiveId: (id: string | null) => void
  setOverColonne: (col: string | null) => void
  handleDrop: (col: string, dropIndex: number) => void | false | Promise<false | void>
}

// ── Config ──

const DRAG_THRESHOLD = 5
const SNAPBACK_MS = 280
const LAND_MS = 180
const LAND_SETTLE_MS = 20   // intentional buffer after clone animation — lets React commit the real card node before cleanup
const TOUCH_DELAY_MS = 200  // long-press delay before drag starts on touch

// ── State ──

let floatingClone: HTMLElement | null = null
let sourceEl: HTMLElement | null = null
let sourceRect: DOMRect | null = null
let offsetX = 0
let offsetY = 0
let activeCbs: DragCallbacks | null = null
let lastOverCol: string | null = null
let pendingEl: HTMLElement | null = null
let pendingId: string | null = null
let startX = 0
let startY = 0
let isDragging = false
let lastDropIndex = 0
let lastOffsetCol: string | null = null
let prevMouseX = 0
let tilt = 0

// Touch long-press delay state
let touchDelayTimer: ReturnType<typeof setTimeout> | null = null
let latestTouchX = 0
let latestTouchY = 0

// rAF throttle for heavy DOM work during drag (hit-test + card offsets)
let rafMoveId: number | null = null
let pendingMoveX = 0
let pendingMoveY = 0

// Column DOM cache: avoids querySelectorAll on every rAF frame
let colBodyCache: HTMLElement | null = null
let colCardsCache: HTMLElement[] = []
// Pending rAF that removes the clearing-drag class after an instant clear
let clearClassRafId: number | null = null
let clearClassRafCol: string | null = null  // which column the pending rAF is for

// ── Card offsets (cards-make-space) ──

function clearCardOffsets(instant = false) {
  const { selectors, classes } = getConfig()
  if (!lastOffsetCol) return
  const col = lastOffsetCol  // capture before nulling
  lastOffsetCol = null
  const colBody = colBodyCache
  const cards = colCardsCache
  colBodyCache = null
  colCardsCache = []
  if (!colBody) return

  // Cancel any pending class-removal rAF only if it targets this same column
  if (clearClassRafId !== null && clearClassRafCol === col) {
    cancelAnimationFrame(clearClassRafId)
    clearClassRafId = null
    clearClassRafCol = null
  }

  if (instant) {
    // Swap classes: remove active-drag (push-apart transition), add clearing-drag (transition:none).
    // Cards snap to '' transform instantly without animating.
    colBody.classList.remove(classes.colActive)
    colBody.classList.add(classes.colClearing)
    for (const card of cards) card.style.transform = ''
    colBody.style.paddingBottom = ''
    // Remove clearing-drag next frame so normal transitions restore
    clearClassRafId = requestAnimationFrame(() => {
      clearClassRafId = null
      clearClassRafCol = null
      colBody.classList.remove(classes.colClearing)
    })
    clearClassRafCol = col
  } else {
    // Non-instant (invalidDrop, off-board): keep active-drag class → push-apart transition
    // plays as cards return to natural position. Set inline transition as fallback.
    for (const card of cards) {
      card.style.transition = 'transform 180ms cubic-bezier(.25,.46,.45,.94)'
      card.style.transform = ''
    }
    colBody.style.paddingBottom = ''
    // Re-query for fresh refs — React may have reordered nodes since cache was built
    requestAnimationFrame(() => {
      const body = document.querySelector(`${selectors.col}[${selectors.colDataAttr}="${CSS.escape(col)}"] ${selectors.colBody}`) as HTMLElement | null
      if (!body) return
      body.classList.remove(classes.colActive)
      body.querySelectorAll(`:scope > ${selectors.card}`).forEach(c => { (c as HTMLElement).style.transition = '' })
    })
  }
}

// prevDropIdx: the drop index from the previous frame (for incremental updates)
// colChanged:  true when we just entered a new column (forces a full update)
function updateCardOffsets(newDropIdx: number, prevDropIdx: number, col: string, colChanged: boolean) {
  const { selectors, classes } = getConfig()
  if (!sourceRect) return

  // Instant-clear the previous column's card transforms
  if (colChanged && lastOffsetCol) clearCardOffsets(true)
  lastOffsetCol = col

  // Refresh cache when entering a new column
  if (colChanged) {
    const colBody = document.querySelector(
      `${selectors.col}[${selectors.colDataAttr}="${CSS.escape(col)}"] ${selectors.colBody}`
    ) as HTMLElement | null
    if (!colBody) { colBodyCache = null; colCardsCache = []; return }
    colBodyCache = colBody
    colCardsCache = Array.from(colBody.querySelectorAll(`:scope > ${selectors.card}`)) as HTMLElement[]
  }

  const colBody = colBodyCache
  if (!colBody) return
  const cards = colCardsCache
  const shiftAmount = sourceRect.height + 8  // card height + column gap

  if (colChanged) {
    colBodyCache!.classList.add(classes.colActive)
    const isSourceCol = sourceEl?.closest<HTMLElement>(selectors.col)?.getAttribute(selectors.colDataAttr) === col
    if (isSourceCol) {
      // Same-column pickup: suppress the initial push-apart animation.
      // active-drag may already be on this column from a prior drag (it's not removed
      // on drop), so the transition rule can be pre-established. Skipping the reflow
      // isn't enough — clearing-drag (transition:none !important) ensures the initial
      // transforms are always instant. Removed next frame so incremental updates animate.
      colBodyCache!.classList.add(classes.colClearing)
      clearClassRafId = requestAnimationFrame(() => {
        clearClassRafId = null
        clearClassRafCol = null
        colBodyCache?.classList.remove(classes.colClearing)
      })
      clearClassRafCol = col
    } else {
      // Cross-column entry: force reflow so push-apart cards animate smoothly in.
      void colBodyCache!.offsetHeight
    }
    for (let i = newDropIdx; i < cards.length; i++) {
      const card = cards[i]
      if (card.style.display === 'none') continue
      card.style.transform = `translateY(${shiftAmount}px)`
    }
  } else {
    // Incremental update: only touch cards whose shifted state changed.
    // If newDropIdx > prevDropIdx, cards [prevDropIdx, newDropIdx) become unshifted.
    // If newDropIdx < prevDropIdx, cards [newDropIdx, prevDropIdx) become shifted.
    const lo = Math.min(prevDropIdx, newDropIdx)
    const hi = Math.max(prevDropIdx, newDropIdx)
    for (let i = lo; i < hi && i < cards.length; i++) {
      const card = cards[i]
      if (card.style.display === 'none') continue
      card.style.transform = i >= newDropIdx ? `translateY(${shiftAmount}px)` : ''
    }
  }

  // Grow the column to contain shifted cards — always, including same-column drags.
  // Same-column: source card (display:none) frees its height but shifted cards extend
  // beyond the new natural bottom; paddingBottom compensates and keeps the column stable.
  colBody.style.paddingBottom = `${shiftAmount}px`
}

// Calculate where the dropped card will land (reads the gap position from current DOM)
function getCardLandingPosition(col: string): { left: number; top: number } | null {
  const { selectors } = getConfig()
  const colBody = document.querySelector(
    `${selectors.col}[${selectors.colDataAttr}="${CSS.escape(col)}"] ${selectors.colBody}`
  ) as HTMLElement | null
  if (!colBody || !sourceRect) return null

  const colBodyRect = colBody.getBoundingClientRect()
  const cards = Array.from(colBody.querySelectorAll(`:scope > ${selectors.card}`)) as HTMLElement[]
  const visibleCards = cards.filter(c => c.style.display !== 'none')

  // Cards before the gap have no transform; cards at/after have translateY applied.
  // The landing zone starts right after the last unshifted card.
  let lastUnshiftedBottom: number | null = null
  for (const card of visibleCards) {
    if (!card.style.transform) {
      lastUnshiftedBottom = card.getBoundingClientRect().bottom
    } else {
      break  // first shifted card — gap is above this
    }
  }

  return {
    left: colBodyRect.left + 8,  // 8px = kbn-col-body padding
    top: lastUnshiftedBottom !== null
      ? lastUnshiftedBottom + 8   // after last unshifted card + column gap (8px)
      : colBodyRect.top + 8,      // dropIdx=0: top of column body + padding
  }
}

// ── Clone ──

function createClone(el: HTMLElement, x: number, y: number) {
  const { selectors, classes } = getConfig()
  const rect = el.getBoundingClientRect()
  sourceRect = rect
  offsetX = x - rect.left
  offsetY = y - rect.top

  const clone = el.cloneNode(true) as HTMLElement
  clone.className = `${selectors.card.slice(1)} ${classes.cardFloating}`
  Object.assign(clone.style, {
    position: 'fixed',
    left: '0',
    top: '0',
    width: `${rect.width}px`,
    zIndex: '9999',
    pointerEvents: 'none',
    margin: '0',
    transform: `translate(${rect.left}px, ${rect.top}px) scale(1.04) rotate(0deg)`,
    boxShadow: '0 16px 40px rgba(0,0,0,.42)',
    transition: 'none',
  })
  document.body.appendChild(clone)
  floatingClone = clone

  sourceEl = el
  el.style.display = 'none'
  prevMouseX = x
}

function moveClone(x: number, y: number) {
  if (!floatingClone) return
  const dx = x - prevMouseX
  prevMouseX = x
  const tiltTarget = Math.max(-5, Math.min(5, dx * 0.3))
  tilt = tilt + (tiltTarget - tilt) * 0.18  // lerp toward velocity-based target
  floatingClone.style.transform = `translate(${x - offsetX}px, ${y - offsetY}px) scale(1.04) rotate(${tilt}deg)`
}

function removeClone() {
  if (floatingClone) { floatingClone.remove(); floatingClone = null }
}

function restoreSource() {
  if (sourceEl) {
    sourceEl.style.animation = 'none'  // prevent kbn-slide-in replay (display:none→'' restarts CSS animations)
    sourceEl.style.display = ''
    sourceEl = null
  }
}

// ── Hit-testing ──

function findColonne(x: number, y: number): string | null {
  const { selectors } = getConfig()
  // elementsFromPoint avoids the display:none/'' toggle that caused 2 layout
  // invalidations per pointermove event. The clone already has pointerEvents:none
  // but elementFromPoint ignores that — iterating the stack and skipping the clone
  // achieves the same "look through" effect without touching the DOM.
  const els = document.elementsFromPoint(x, y)
  for (const el of els) {
    if (floatingClone?.contains(el as Node)) continue
    const col = el.closest(selectors.col) as HTMLElement | null
    if (col) return col.getAttribute(selectors.colDataAttr) ?? null
  }
  return null
}

function findDropIndex(y: number, col: string): number {
  const { selectors } = getConfig()
  // Use cached card list to avoid querySelectorAll on every frame
  const cards = (lastOffsetCol === col && colCardsCache.length > 0)
    ? colCardsCache
    : (() => {
        const colEl = document.querySelector(`${selectors.col}[${selectors.colDataAttr}="${CSS.escape(col)}"] ${selectors.colBody}`)
        return colEl ? Array.from(colEl.querySelectorAll(`:scope > ${selectors.card}`)) as HTMLElement[] : []
      })()
  for (let i = 0; i < cards.length; i++) {
    if (cards[i].style.display === 'none') continue
    const rect = cards[i].getBoundingClientRect()
    if (y < rect.top + rect.height / 2) return i
  }
  return cards.length
}

function suppressNextClick(e: MouseEvent) {
  e.stopPropagation()
  e.preventDefault()
  document.removeEventListener('click', suppressNextClick, true)
}

// ── Drag lifecycle ──

function startDrag(el: HTMLElement, x: number, y: number) {
  const { classes } = getConfig()
  isDragging = true
  activeCbs!.setActiveId(pendingId!)
  createClone(el, x, y)
  document.body.classList.add(classes.dragging)
  document.addEventListener('click', suppressNextClick, true)
}

function cancelTouchDelay() {
  if (touchDelayTimer !== null) { clearTimeout(touchDelayTimer); touchDelayTimer = null }
  document.removeEventListener('pointermove', onTouchDelayMove)
  document.removeEventListener('pointerup', onTouchDelayUp)
  document.removeEventListener('pointercancel', onTouchDelayUp)
  pendingEl = null
  pendingId = null
  activeCbs = null
}

function onTouchDelayMove(e: PointerEvent) {
  latestTouchX = e.clientX
  latestTouchY = e.clientY
  if (Math.abs(e.clientX - startX) > 8 || Math.abs(e.clientY - startY) > 8) cancelTouchDelay()
}

function onTouchDelayUp() {
  cancelTouchDelay()
}

function cleanup() {
  const { classes } = getConfig()
  if (touchDelayTimer !== null) { clearTimeout(touchDelayTimer); touchDelayTimer = null }
  document.removeEventListener('pointermove', onTouchDelayMove)
  document.removeEventListener('pointerup', onTouchDelayUp)
  document.removeEventListener('pointercancel', onTouchDelayUp)
  if (rafMoveId !== null) { cancelAnimationFrame(rafMoveId); rafMoveId = null }
  if (clearClassRafId !== null) { cancelAnimationFrame(clearClassRafId); clearClassRafId = null }
  clearClassRafCol = null
  pendingMoveX = 0
  pendingMoveY = 0
  stopAutoScroll()
  clearCardOffsets()
  lastOffsetCol = null
  colBodyCache?.classList.remove(classes.colActive, classes.colClearing)
  colBodyCache = null
  colCardsCache = []
  tilt = 0
  prevMouseX = 0
  activeCbs = null
  lastOverCol = null
  pendingEl = null
  pendingId = null
  isDragging = false
  sourceRect = null
  lastDropIndex = 0
}

function validDrop(col: string) {
  const { selectors, classes } = getConfig()
  // Guard against race condition: a double pointerup or an external cleanup() call
  // can null activeCbs before the animation callbacks complete. Bail out silently
  // rather than crashing on the ! assertion below.
  if (!activeCbs) { cleanup(); return }
  stopAutoScroll()
  const cbs = activeCbs
  const clone = floatingClone
  const savedDropIndex = lastDropIndex

  // 1. Read landing position while gap is still open
  const targetPos = getCardLandingPosition(col)

  // 2. Update column highlight immediately
  cbs.setOverColonne(null)

  // 3. Freeze drag state — lastOffsetCol intentionally NOT cleared (gap stays open during flight)
  // Detect same-column now while sourceEl is still attached to the DOM
  const isSameCol = (sourceEl?.closest(selectors.col) as HTMLElement | null)?.getAttribute(selectors.colDataAttr) === col
  activeCbs = null
  lastOverCol = null
  pendingEl = null
  pendingId = null
  isDragging = false
  sourceRect = null
  lastDropIndex = 0
  tilt = 0
  prevMouseX = 0

  if (!clone || !targetPos) {
    // Fallback: fire immediately
    clearCardOffsets(true)
    Promise.resolve(cbs.handleDrop(col, savedDropIndex)).then(result => {
      requestAnimationFrame(() => {
        removeClone()
        if (result === false) restoreSource()
        else { const srcCol = sourceEl?.closest(selectors.col)?.getAttribute(selectors.colDataAttr); if (srcCol === col) restoreSource(); else sourceEl = null }
      })
      cbs.setActiveId(null)
    })
    return
  }

  // 4. Animate clone to landing position — gap stays open during entire flight.
  // Split transition setup and value change with a forced reflow so the browser commits
  // the "before" transform state before starting the animation. Without this, setting
  // transition + transform in the same batch skips the animation (clone jumps instantly).
  clone.style.transition = `transform ${LAND_MS}ms ease-out`
  void clone.offsetWidth  // force style flush — establishes current transform as "from" state
  clone.style.transform = `translate(${targetPos.left}px, ${targetPos.top}px) scale(1) rotate(0deg)`
  clone.style.boxShadow = '0 2px 8px rgba(0,0,0,.12)'

  // 5. After animation: React update, clear stale inline styles, remove clone.
  //    On attend LAND_MS (durée transition clone) + LAND_SETTLE_MS intentionnels.
  //    Le +LAND_SETTLE_MS n'est pas un buffer arbitraire : il laisse React committer
  //    le vrai nœud carte après la résolution de handleDrop (optimistic update
  //    + re-render). transitionend fire trop tôt — le clone disparaît avant
  //    que la carte réelle soit dans le DOM, ce qui provoque un flash.
  //    Si LAND_MS change, ajuster aussi la transition CSS du clone pour rester
  //    cohérent — ces deux valeurs sont couplées par design.
   const onLanded = async () => {
    const savedSourceEl = sourceEl // PATCH A

    if (floatingClone) {
      floatingClone.style.zIndex = '1'
      floatingClone.style.transform = `translate(${targetPos.left}px, ${targetPos.top}px) scale(1) rotate(0deg)`
      floatingClone.style.boxShadow = '0 2px 8px rgba(0,0,0,.12)'
    }

    if (!isSameCol) {
      clearCardOffsets(true)
    }
    lastOffsetCol = null

    let cloneHandled = false
    let observer: MutationObserver | null = null
    if (!isSameCol) {
      const colBodyTarget = document.querySelector(`${selectors.col}[${selectors.colDataAttr}="${CSS.escape(col)}"] ${selectors.colBody}`) as HTMLElement | null
      if (colBodyTarget) {
        observer = new MutationObserver(() => {
          observer?.disconnect()
          observer = null
          colBodyTarget.querySelectorAll(`:scope > ${selectors.card}`).forEach(c => {
            const el = c as HTMLElement
            el.style.display = ''
            el.style.animation = 'none'
          })
          removeClone()
          sourceEl = null
          cloneHandled = true
        })
        observer.observe(colBodyTarget, { childList: true })
      }
    }

    const result = await Promise.resolve(cbs.handleDrop(col, savedDropIndex))

    if (!isSameCol) {
      await new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))) // PATCH B
      observer?.disconnect()
      observer = null
      if (!cloneHandled) {
        const colBodyFresh = document.querySelector(`${selectors.col}[${selectors.colDataAttr}="${CSS.escape(col)}"] ${selectors.colBody}`) as HTMLElement | null
        colBodyFresh?.querySelectorAll(`:scope > ${selectors.card}`).forEach(c => {
          const el = c as HTMLElement
          el.style.display = ''
          el.style.animation = 'none'
        })
        if (savedSourceEl) savedSourceEl.style.display = '' // PATCH C
        removeClone()
        if (result === false) restoreSource()
        else sourceEl = null
        cloneHandled = true
      }
      cbs.setActiveId(null)
      return
    }

    requestAnimationFrame(() => {
      const colBodyPost = document.querySelector(`${selectors.col}[${selectors.colDataAttr}="${CSS.escape(col)}"] ${selectors.colBody}`) as HTMLElement | null
      if (colBodyPost) {
        colBodyPost.classList.remove(classes.colActive)
        colBodyPost.style.paddingBottom = ''
        colBodyPost.querySelectorAll(`:scope > ${selectors.card}`).forEach(c => {
          const el = c as HTMLElement
          el.style.transition = 'none'
          el.style.transform = ''
          el.style.animation = 'none'
        })
        colBodyPost.querySelectorAll(`:scope > ${selectors.card}`).forEach(c => {
          const el = c as HTMLElement
          el.style.transition = ''
          el.style.animation = 'none'
        })
      }
      removeClone()
      restoreSource()
      cbs.setActiveId(null)
    })
  }

  setTimeout(onLanded, LAND_MS + LAND_SETTLE_MS)
}

function invalidDrop() {
  // Guard against race condition: a double pointerup or an external cleanup() call
  // can null activeCbs before the snapback animation completes. Bail out silently.
  if (!activeCbs) { cleanup(); return }
  const cbs = activeCbs
  const clone = floatingClone
  const el = sourceEl
  cbs.setOverColonne(null)
  clearCardOffsets()  // animated return: cards slide back while clone snaps

  if (clone && sourceRect) {
    // Restore source immediately so column reserves space during snapback — no height jump.
    // visibility:hidden keeps layout but stays invisible. React doesn't manage visibility
    // in the card's JSX style so it won't overwrite it (unlike opacity which React sets
    // inline and would flash the card visible on its first batched re-render).
    if (el) { el.style.display = ''; el.style.visibility = 'hidden' }

    clone.style.transition = `transform ${SNAPBACK_MS}ms cubic-bezier(.34,1.56,.64,1)`
    void clone.offsetWidth  // force style flush — establishes current transform as "from" state
    clone.style.transform = `translate(${sourceRect.left}px, ${sourceRect.top}px) scale(1) rotate(0deg)`
    clone.style.boxShadow = '0 2px 4px rgba(0,0,0,.08)'

    setTimeout(() => {
      removeClone()
      if (el) el.style.visibility = ''
      sourceEl = null
      cbs.setActiveId(null)
      cleanup()
    }, SNAPBACK_MS)
  } else {
    removeClone(); restoreSource(); cbs.setActiveId(null); cleanup()
  }
}

// ── Pointer handlers ──

// Heavy DOM work (hit-test + card offsets) runs once per animation frame.
// The clone itself is moved on every event for imperceptible visual latency.
function processPendingMove() {
  rafMoveId = null
  if (!isDragging || !activeCbs) return
  const x = pendingMoveX
  const y = pendingMoveY
  updateAutoScroll(x, y)
  const col = findColonne(x, y)
  if (col !== lastOverCol) { lastOverCol = col; activeCbs.setOverColonne(col) }
  if (col) {
    // Invalidate intra-column cache if React changed the card count during the drag
    // (optimistic update while dragging). childElementCount is O(1) — no querySelectorAll.
    // Nulling lastOffsetCol makes colChanged=true on the next updateCardOffsets call,
    // which triggers a full cache rebuild. Only fires when the count actually changes.
    if (col === lastOffsetCol && colBodyCache !== null &&
        colBodyCache.childElementCount !== colCardsCache.length) {
      lastOffsetCol = null
    }
    const newDropIdx = findDropIndex(y, col)
    // Skip card offset writes entirely when the gap position hasn't changed
    if (newDropIdx !== lastDropIndex || col !== lastOffsetCol) {
      const prevDropIdx = lastDropIndex
      const colChanged = col !== lastOffsetCol
      lastDropIndex = newDropIdx
      updateCardOffsets(newDropIdx, prevDropIdx, col, colChanged)
    }
  } else {
    clearCardOffsets()
  }
}

function onPointerMove(e: PointerEvent) {
  if (!isDragging) {
    if (Math.abs(e.clientX - startX) < DRAG_THRESHOLD && Math.abs(e.clientY - startY) < DRAG_THRESHOLD) return
    if (!pendingEl) return
    startDrag(pendingEl, startX, startY)
  }
  // Clone follows pointer immediately (O(1) style writes, visually smooth at any Hz)
  moveClone(e.clientX, e.clientY)
  // Throttle the rest (DOM reads + card transform writes) to one per rAF
  pendingMoveX = e.clientX
  pendingMoveY = e.clientY
  if (rafMoveId === null) {
    rafMoveId = requestAnimationFrame(processPendingMove)
  }
}

function onPointerCancel() {
  document.removeEventListener('pointermove', onPointerMove)
  document.removeEventListener('pointerup', onPointerUp)
  document.removeEventListener('pointercancel', onPointerCancel)
  if (isDragging) { invalidDrop() } else { cleanup() }
}

function onPointerUp(e: PointerEvent) {
  const { selectors, classes } = getConfig()
  document.removeEventListener('pointermove', onPointerMove)
  document.removeEventListener('pointerup', onPointerUp)
  document.removeEventListener('pointercancel', onPointerCancel)

  if (!isDragging) { cleanup(); return }

  // Cancel any pending rAF and compute the final drop index synchronously so
  // it isn't one frame stale when validDrop reads lastDropIndex.
  if (rafMoveId !== null) { cancelAnimationFrame(rafMoveId); rafMoveId = null }
  const col = findColonne(e.clientX, e.clientY)
  if (col) lastDropIndex = findDropIndex(e.clientY, col)

  // Freeze animation:none inline on all cards before removing the CSS override
  document.querySelectorAll(selectors.card).forEach(c => { (c as HTMLElement).style.animation = 'none' })
  document.body.classList.remove(classes.dragging)

  if (col && activeCbs) { validDrop(col) } else { invalidDrop() }
}

// ── Public API ──

export function onCardPointerDown(e: PointerEvent, id: string, callbacks: DragCallbacks, el?: HTMLElement) {
  if (e.button !== 0) return
  // In vanilla JS, el is omitted and currentTarget is the card element (listener attached directly).
  // In React, pass e.currentTarget as HTMLElement from the synthetic event — nativeEvent.currentTarget
  // points to the React root due to event delegation, not the card.
  pendingEl = el ?? e.currentTarget as HTMLElement
  pendingId = id
  startX = e.clientX
  startY = e.clientY
  activeCbs = callbacks
  isDragging = false

  if (e.pointerType === 'touch') {
    // Touch: wait TOUCH_DELAY_MS before activating drag.
    // If the finger moves > 8px during the delay, it's a scroll — cancel silently.
    // If the finger lifts or the browser cancels — also cancel.
    latestTouchX = e.clientX
    latestTouchY = e.clientY
    touchDelayTimer = setTimeout(() => {
      touchDelayTimer = null
      document.removeEventListener('pointermove', onTouchDelayMove)
      document.removeEventListener('pointerup', onTouchDelayUp)
      document.removeEventListener('pointercancel', onTouchDelayUp)
      if (!pendingEl || !activeCbs) return
      document.addEventListener('pointermove', onPointerMove)
      document.addEventListener('pointerup', onPointerUp)
      document.addEventListener('pointercancel', onPointerCancel)
      startDrag(pendingEl, latestTouchX, latestTouchY)
    }, TOUCH_DELAY_MS)
    document.addEventListener('pointermove', onTouchDelayMove)
    document.addEventListener('pointerup', onTouchDelayUp)
    document.addEventListener('pointercancel', onTouchDelayUp)
  } else {
    document.addEventListener('pointermove', onPointerMove)
    document.addEventListener('pointerup', onPointerUp)
    document.addEventListener('pointercancel', onPointerCancel)
  }
}

// ── Kanban order with priority support ──

export function applyStoredOrder<T>(
  items: T[],
  getId: (item: T) => string,
  storedIds: string[],
  isPrio?: (item: T) => boolean,
): T[] {
  if (!storedIds.length && !isPrio) return items

  const posMap = new Map<string, number>()
  storedIds.forEach((id, i) => posMap.set(id, i))

  const sorted = [...items].sort((a, b) => {
    const posA = posMap.get(getId(a)) ?? 9999
    const posB = posMap.get(getId(b)) ?? 9999
    return posA - posB
  })

  if (!isPrio) return sorted

  // Partition: prioritized items first, then non-prioritized
  return [...sorted.filter(i => isPrio(i)), ...sorted.filter(i => !isPrio(i))]
}
