// TODO: copy from source
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

export declare function configureKanbanDrag(config: Partial<KanbanDragConfig>): void
export declare function getConfig(): KanbanDragConfig
