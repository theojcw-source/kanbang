export interface KanbanDragConfig {
  selectors: {
    col: string
    colBody: string
    card: string
    board: string
    colDataAttr: string
  }
  classes: {
    dragging: string
    cardFloating: string
    colActive: string
    colClearing: string
    boardScrolling: string
  }
}

export const defaultConfig: KanbanDragConfig = {
  selectors: {
    col: '.kbn-col',
    colBody: '.kbn-col-body',
    card: '.kbn-card',
    board: '.kbn-board',
    colDataAttr: 'data-colonne',
  },
  classes: {
    dragging: 'kbn-dragging',
    cardFloating: 'kbn-card--floating',
    colActive: 'kbn-col-body--active-drag',
    colClearing: 'kbn-col-body--clearing-drag',
    boardScrolling: 'kbn-board--autoscrolling',
  },
}

let _config: KanbanDragConfig = defaultConfig

export function configureKanbanDrag(config: Partial<KanbanDragConfig>): void {
  _config = { ...defaultConfig, ...config }
}

export function getConfig(): KanbanDragConfig { return _config }
