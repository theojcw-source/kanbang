import { useState, useEffect, useRef, useMemo, useCallback } from 'react'
import { flushSync } from 'react-dom'
import { onCardPointerDown, configureKanbanDrag, applyStoredOrder } from 'kanbang'
import type { DragCallbacks } from 'kanbang'
import './kb.css'

// ── Config ───────────────────────────────────────────────────────────────────

configureKanbanDrag({
  selectors: {
    col:        '.kb-col',
    colBody:    '.kb-col-body',
    card:       '.kb-card',
    board:      '#board',
    colDataAttr: 'data-col',
  },
  classes: {
    dragging:        'kb-dragging',
    cardFloating:    'kb-card--floating',
    colActive:       'kb-col-body--active-drag',
    colClearing:     'kb-col-body--clearing-drag',
    boardScrolling:  'kb-board--scrolling',
  },
})

// ── Types ─────────────────────────────────────────────────────────────────────

interface Card { id: string; text: string }
type ColId = 'todo' | 'doing' | 'done'
type Columns = Record<ColId, Card[]>

const COL_META: Record<ColId, { label: string }> = {
  todo:  { label: 'To do' },
  doing: { label: 'In progress' },
  done:  { label: 'Done' },
}
const COL_ORDER: ColId[] = ['todo', 'doing', 'done']

// ── LocalStorage ──────────────────────────────────────────────────────────────

const LS_KEY = 'kanbang-react-demo-v1'

const DEFAULT_COLUMNS: Columns = {
  todo: [
    { id: '1', text: 'Design the API surface' },
    { id: '2', text: 'Write unit tests' },
    { id: '3', text: 'Update README' },
  ],
  doing: [
    { id: '4', text: 'Implement drag & drop' },
  ],
  done: [
    { id: '5', text: 'Set up monorepo' },
  ],
}

function loadColumns(): Columns {
  try {
    const raw = localStorage.getItem(LS_KEY)
    if (!raw) return DEFAULT_COLUMNS
    const stored = JSON.parse(raw) as Record<string, string[]>
    // stored is { colId: [id, id, ...] } — restore Card objects using applyStoredOrder
    const result = { ...DEFAULT_COLUMNS }
    for (const colId of COL_ORDER) {
      if (stored[colId]) {
        // build a flat lookup of all cards
        const allCards = COL_ORDER.flatMap(c => DEFAULT_COLUMNS[c])
        const lookup = Object.fromEntries(allCards.map(c => [c.id, c]))
        // stored[colId] contains ids present in that col
        const idsInCol = stored[colId]
        result[colId] = applyStoredOrder(
          DEFAULT_COLUMNS[colId].filter(c => idsInCol.includes(c.id)),
          c => c.id,
          idsInCol,
        )
        // also add cards that were moved into this col from others
        for (const id of idsInCol) {
          if (!result[colId].find(c => c.id === id) && lookup[id]) {
            result[colId].push(lookup[id])
          }
        }
      }
    }
    return result
  } catch {
    return DEFAULT_COLUMNS
  }
}

function serializeColumns(cols: Columns): Record<ColId, string[]> {
  const out = {} as Record<ColId, string[]>
  for (const colId of COL_ORDER) out[colId] = cols[colId].map(c => c.id)
  return out
}

// ── Pub-sub drag state ────────────────────────────────────────────────────────

interface DragState { activeId: string | null; overCol: string | null }

const subscribers = new Set<(s: DragState) => void>()
let drag: DragState = { activeId: null, overCol: null }

function setDrag(update: Partial<DragState>) {
  drag = { ...drag, ...update }
  subscribers.forEach(fn => fn(drag))
}

// ── useDrag hook ──────────────────────────────────────────────────────────────

function useDrag(colId: string, handleDrop: (col: string, dropIndex: number) => void) {
  const [state, setState] = useState<DragState>(drag)
  const hdRef = useRef(handleDrop)
  hdRef.current = handleDrop

  useEffect(() => {
    subscribers.add(setState)
    return () => { subscribers.delete(setState) }
  }, [])

  const callbacks = useMemo<DragCallbacks>(() => ({
    setActiveId:    (id) => setDrag({ activeId: id }),
    setOverColonne: (col) => setDrag({ overCol: col }),
    handleDrop:     (col, idx) => hdRef.current(col, idx),
  }), [])

  return {
    activeId: state.activeId,
    isOver:   state.overCol === colId,
    callbacks,
  }
}

// ── KanbanColumn ──────────────────────────────────────────────────────────────

interface KanbanColumnProps {
  colId: ColId
  cards: Card[]
  onDrop: (col: string, dropIndex: number) => void
}

function KanbanColumn({ colId, cards, onDrop }: KanbanColumnProps) {
  const { activeId, isOver, callbacks } = useDrag(colId, onDrop)

  return (
    <div className={`kb-col${isOver ? ' kb-col--over' : ''}`} data-col={colId}>
      <div className="kb-col-header">
        <div className="kb-col-header-left">
          <span className="kb-col-dot" />
          <span className="kb-col-title">{COL_META[colId].label}</span>
        </div>
        <span className="kb-col-count">{cards.length}</span>
      </div>
      <div className="kb-col-body">
        {cards.map(card => (
          <div
            key={card.id}
            className="kb-card"
            data-id={card.id}
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

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [columns, setColumns] = useState<Columns>(loadColumns)

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(serializeColumns(columns)))
  }, [columns])

  const handleDrop = useCallback((col: string, dropIndex: number) => {
    const id = drag.activeId   // module-level — always fresh, no stale closure
    if (!id) return

    flushSync(() => {
      setColumns(prev => {
        // find source col
        const srcCol = COL_ORDER.find(c => prev[c].some(card => card.id === id))
        if (!srcCol) return prev
        const card = prev[srcCol].find(c => c.id === id)!
        const next = { ...prev }
        // remove from source
        next[srcCol] = prev[srcCol].filter(c => c.id !== id)
        // insert into target
        const target = [...next[col as ColId]]
        const clampedIdx = Math.min(dropIndex, target.length)
        target.splice(clampedIdx, 0, card)
        next[col as ColId] = target
        return next
      })
    })
  }, [])

  return (
    <>
      <header>
        <h1>kanbang</h1>
        <p>React demo · drag to reorder · order persisted in localStorage</p>
      </header>
      <div className="kb-board" id="board">
        {COL_ORDER.map(colId => (
          <KanbanColumn
            key={colId}
            colId={colId}
            cards={columns[colId]}
            onDrop={handleDrop}
          />
        ))}
      </div>
    </>
  )
}
