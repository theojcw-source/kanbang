# kanbang

Lightweight, zero-dependency kanban drag & drop library with injectable CSS config.

Pointer-based (mouse + touch), rAF-throttled, with cards-push-apart animations and velocity tilt.

## Install

```bash
npm install kanbang
```

## Usage

### React

```tsx
import { onCardPointerDown, applyStoredOrder } from 'kanbang'

function KanbanCard({ id, callbacks }) {
  return (
    <div
      className="kbn-card"
      onPointerDown={e => onCardPointerDown(e, id, callbacks)}
    >
      {id}
    </div>
  )
}
```

### Vanilla

```ts
import { onCardPointerDown } from 'kanbang'

card.addEventListener('pointerdown', e =>
  onCardPointerDown(e, card.dataset.id, callbacks)
)
```

## Configuration

Override any selector or class name to match your own CSS:

```ts
import { configureKanbanDrag } from 'kanbang'

configureKanbanDrag({
  selectors: {
    col: '.my-col',
    colBody: '.my-col-body',
    card: '.my-card',
    board: '.my-board',
    colDataAttr: 'data-col-id',
  },
  classes: {
    dragging: 'is-dragging',
    cardFloating: 'card--floating',
    colActive: 'col--active',
    colClearing: 'col--clearing',
    boardScrolling: 'board--scrolling',
  },
})
```

## API

### `onCardPointerDown(e, id, callbacks)`

Initiates a drag on pointer down. Touch devices use a 200ms long-press delay to
distinguish drag from scroll.

| Param | Type | Description |
|---|---|---|
| `e` | `React.PointerEvent` | The pointerdown event |
| `id` | `string` | Unique card identifier |
| `callbacks` | `DragCallbacks` | `setActiveId`, `setOverColonne`, `handleDrop` |

### `applyStoredOrder(items, getId, storedIds, isPrio?)`

Sorts `items` by a persisted `storedIds` array. Pass an optional `isPrio`
predicate to always float priority items to the top.

### `configureKanbanDrag(config)`

Overrides the default CSS selectors and class names. Call once before mounting
your kanban board.

### `updateAutoScroll(x, y)` / `stopAutoScroll()`

Called internally during drag. Export these if you need manual control.

## Default CSS classes

| Config key | Default value |
|---|---|
| `selectors.col` | `.kbn-col` |
| `selectors.colBody` | `.kbn-col-body` |
| `selectors.card` | `.kbn-card` |
| `selectors.board` | `.kbn-board` |
| `selectors.colDataAttr` | `data-colonne` |
| `classes.dragging` | `kbn-dragging` |
| `classes.cardFloating` | `kbn-card--floating` |
| `classes.colActive` | `kbn-col-body--active-drag` |
| `classes.colClearing` | `kbn-col-body--clearing-drag` |
| `classes.boardScrolling` | `kbn-board--autoscrolling` |

## License

MIT © Théo
