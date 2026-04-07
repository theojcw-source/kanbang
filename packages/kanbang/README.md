# kanbang

> Fluid pointer-based kanban drag-and-drop. No dependencies.  
> Touch, tilt, auto-scroll, landing animation.

## Features

- **Touch support** — 200 ms long-press activates drag; moving the finger > 8 px during that window cancels silently so normal scroll is uninterrupted
- **Velocity tilt** — floating clone rotates based on horizontal pointer velocity (lerped, not snappy)
- **Auto-scroll** — board scrolls horizontally and window scrolls vertically, quadratic velocity curve
- **Landing animation** — clone flies to the drop position; real card appears underneath at the right moment
- **Cards-make-space** — sibling cards push apart during drag, rAF-throttled, DOM cached per column
- **Snapback** — spring animation when the card is dropped off-board or `handleDrop` returns `false`
- **Framework-agnostic** — works with vanilla JS, React, Vue, or any DOM-based renderer
- **< 5 kb gzip**

## Install

```sh
npm install kanbang
pnpm add kanbang
yarn add kanbang
```

## Quick start

```html
<div id="board">
  <div class="kb-col" data-col="todo">
    <div class="kb-col-body">
      <div class="kb-card" data-id="1">Card A</div>
      <div class="kb-card" data-id="2">Card B</div>
    </div>
  </div>
  <div class="kb-col" data-col="done">
    <div class="kb-col-body"></div>
  </div>
</div>
```

```js
import { configureKanbanDrag, onCardPointerDown } from 'kanbang'

configureKanbanDrag({
  selectors: {
    col:         '.kb-col',
    colBody:     '.kb-col-body',
    card:        '.kb-card',
    board:       '#board',
    colDataAttr: 'data-col',
  },
  classes: {
    dragging:       'kb-dragging',
    cardFloating:   'kb-card--floating',
    colActive:      'kb-col-body--active-drag',
    colClearing:    'kb-col-body--clearing-drag',
    boardScrolling: 'kb-board--scrolling',
  },
})

let state = { todo: ['1', '2'], done: [] }
let draggingId = null

const callbacks = {
  setActiveId(id) {
    draggingId = id
  },
  setOverColonne(col) {
    document.querySelectorAll('.kb-col').forEach(el => el.classList.remove('kb-col--over'))
    if (col) document.querySelector(`.kb-col[data-col="${col}"]`)?.classList.add('kb-col--over')
  },
  handleDrop(col, dropIndex) {
    const id = draggingId
    const srcCol = Object.keys(state).find(c => state[c].includes(id))
    if (!srcCol) return
    state[srcCol] = state[srcCol].filter(i => i !== id)
    state[col].splice(dropIndex, 0, id)
    // Move the existing DOM node — do not rebuild innerHTML
    const card = document.querySelector(`.kb-card[data-id="${id}"]`)
    const colBody = document.querySelector(`.kb-col[data-col="${col}"] .kb-col-body`)
    const sibling = colBody.children[dropIndex] ?? null
    colBody.insertBefore(card, sibling)
  },
}

document.querySelectorAll('.kb-card').forEach(card => {
  card.addEventListener('pointerdown', e => onCardPointerDown(e, card.dataset.id, callbacks))
})
```

> Use `insertBefore` to move the existing card node rather than rebuilding `innerHTML`. kanbang uses a `MutationObserver` on the target column body to detect the insertion and remove the floating clone at the right time. Replacing the DOM from scratch does not trigger it.

## React example

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { configureKanbanDrag, onCardPointerDown } from 'kanbang'
import type { DragCallbacks } from 'kanbang'

configureKanbanDrag({ /* same config as above */ })

// Module-level pub-sub keeps useDrag() calls across columns in sync
type DragState = { activeId: string | null; overCol: string | null }
const subscribers = new Set<(s: DragState) => void>()
let drag: DragState = { activeId: null, overCol: null }
const setDrag = (u: Partial<DragState>) => {
  drag = { ...drag, ...u }
  subscribers.forEach(fn => fn(drag))
}

function useDrag(colId: string, handleDrop: (col: string, idx: number) => void) {
  const [state, setState] = useState<DragState>(drag)
  const hdRef = useRef(handleDrop)
  hdRef.current = handleDrop
  useEffect(() => {
    subscribers.add(setState)
    return () => { subscribers.delete(setState) }
  }, [])
  const callbacks = useMemo<DragCallbacks>(() => ({
    setActiveId:    id  => setDrag({ activeId: id }),
    setOverColonne: col => setDrag({ overCol: col }),
    handleDrop:     (col, idx) => hdRef.current(col, idx),
  }), [])
  return { activeId: state.activeId, isOver: state.overCol === colId, callbacks }
}

function KanbanColumn({ colId, cards, onDrop }) {
  const { activeId, isOver, callbacks } = useDrag(colId, onDrop)
  return (
    <div className={`kb-col${isOver ? ' kb-col--over' : ''}`} data-col={colId}>
      <div className="kb-col-body">
        {cards.map(card => (
          <div
            key={card.id}
            className="kb-card"
            style={activeId === card.id ? { opacity: 0.4 } : undefined}
            onPointerDown={e => onCardPointerDown(e.nativeEvent, card.id, callbacks)}
          >
            {card.text}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function App() {
  const [columns, setColumns] = useState({ todo: [/* ... */], done: [/* ... */] })

  const handleDrop = useCallback((col: string, dropIndex: number) => {
    const id = drag.activeId  // read from module-level — never a stale closure
    if (!id) return
    flushSync(() => {
      setColumns(prev => {
        // move card from source col to col at dropIndex
        // ...
        return next
      })
    })
  }, [])

  return (
    <div id="board" className="kb-board">
      {['todo', 'done'].map(colId => (
        <KanbanColumn key={colId} colId={colId} cards={columns[colId]} onDrop={handleDrop} />
      ))}
    </div>
  )
}
```

> `flushSync` forces React to commit the DOM synchronously inside `handleDrop`. This is what triggers the `MutationObserver` that removes the floating clone. Without it, the clone and the real card briefly coexist.

## API

### `configureKanbanDrag(config)`

Call once at module level before any drag interaction. Accepts a partial config — unspecified keys use their defaults.

| Key | Default | Description |
|---|---|---|
| `selectors.col` | `'.kbn-col'` | Column root element |
| `selectors.colBody` | `'.kbn-col-body'` | Direct parent of cards; receives push-apart transforms |
| `selectors.card` | `'.kbn-card'` | Draggable card element |
| `selectors.board` | `'.kbn-board'` | Horizontal-scrolling board container |
| `selectors.colDataAttr` | `'data-colonne'` | Attribute on the column root holding the column identifier |
| `classes.dragging` | `'kbn-dragging'` | Added to `<body>` during drag |
| `classes.cardFloating` | `'kbn-card--floating'` | Applied to the floating clone |
| `classes.colActive` | `'kbn-col-body--active-drag'` | Added to a column body while cards are being pushed apart |
| `classes.colClearing` | `'kbn-col-body--clearing-drag'` | Added transiently to suppress push-apart transitions during instant resets |
| `classes.boardScrolling` | `'kbn-board--autoscrolling'` | Added to the board during auto-scroll |

---

### `onCardPointerDown(e, id, callbacks)`

Attach to each card's `pointerdown` event.

| Param | Type | Description |
|---|---|---|
| `e` | `PointerEvent` | Raw pointer event. Only `button === 0` is handled (left click / primary touch). |
| `id` | `string` | Unique card identifier. Passed to `setActiveId`; retrieve it in `handleDrop` via your own reference. |
| `callbacks` | `DragCallbacks` | See below. |

**Mouse / stylus:** drag activates after the pointer moves > 5 px from the start position.  
**Touch:** a 200 ms long-press is required. Moving the finger > 8 px during the delay cancels the drag and lets the scroll proceed normally. Lifting the finger also cancels.

---

### `applyStoredOrder(items, getId, storedIds, isPrio?)`

Reorders `items` to match a persisted `storedIds` array (e.g. from localStorage). Items absent from `storedIds` are appended at the end in their original relative order.

| Param | Type | Description |
|---|---|---|
| `items` | `T[]` | Source array to reorder |
| `getId` | `(item: T) => string` | Returns the item's id |
| `storedIds` | `string[]` | Ordered list of ids as persisted |
| `isPrio?` | `(item: T) => boolean` | When provided, items where `isPrio` returns `true` are floated to the top of the result. Each group (priority / non-priority) is ordered independently by `storedIds`. |

```js
// Restore persisted order
const ordered = applyStoredOrder(cards, c => c.id, storedIds)

// Pinned cards always appear first; both groups respect stored order
const ordered = applyStoredOrder(cards, c => c.id, storedIds, c => c.pinned)
```

---

### `DragCallbacks`

```ts
interface DragCallbacks {
  setActiveId(id: string | null): void
  setOverColonne(col: string | null): void
  handleDrop(col: string, dropIndex: number): void | false | Promise<false | void>
}
```

| Field | Called when | Expected behavior |
|---|---|---|
| `setActiveId` | Drag starts (`id`) and ends (`null`) | Track which card is being dragged, e.g. to dim it in your UI |
| `setOverColonne` | Pointer enters a column (`col`) or leaves all columns (`null`) | Highlight / unhighlight the hovered column |
| `handleDrop` | Card is released over a valid column | Move the card in your state or DOM. `col` is the column identifier from `colDataAttr`. `dropIndex` is the 0-based insertion index in the visible card list. Returning `false` (or resolving to `false`) cancels the drop and triggers the snapback animation. |

`handleDrop` fires **mid-animation** — the clone is still flying toward the drop target when it is called. In vanilla JS, move the real card node with `insertBefore`. In React, wrap the state update in `flushSync`.

---

## CSS requirements

kanbang reads the DOM and writes inline `transform`, `display`, and `paddingBottom` on cards and column bodies. All visual styles are yours.

**Minimum HTML structure:**

```html
<div id="board">                        <!-- matches selectors.board -->
  <div class="col" data-col="todo">     <!-- matches selectors.col, carries colDataAttr -->
    <div class="col-body">             <!-- matches selectors.colBody -->
      <div class="card">…</div>        <!-- matches selectors.card -->
    </div>
  </div>
</div>
```

**Classes kanbang toggles — you must style them:**

| Class (config key) | Applied to | Purpose |
|---|---|---|
| `colActive` | `.col-body` | Enables push-apart transitions. Add `transition: transform …` to cards inside this class. |
| `colClearing` | `.col-body` | Suppresses transitions for instant resets. Add `transition: none !important` to cards inside this class. |
| `cardFloating` | Floating clone | Lifted shadow, `cursor: grabbing`, no `touch-action`. |
| `dragging` | `<body>` | Global `cursor: grabbing`, `pointer-events: none` on cards. |
| `boardScrolling` | Board container | Optional; use for visual feedback during auto-scroll. |

**Recommended transitions for push-apart animations:**

```css
.kb-col-body--active-drag .kb-card {
  transition: transform 160ms cubic-bezier(.25, .46, .45, .94);
}
.kb-col-body--clearing-drag .kb-card {
  transition: none !important;
}
```

Without these two rules the push-apart feature still works, but cards jump to their offset positions instead of sliding.

## License

MIT
