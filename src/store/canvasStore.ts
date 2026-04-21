import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { persist, type PersistStorage } from 'zustand/middleware';
import { get, set, del } from 'idb-keyval';
import { NodeData, CanvasState, Point } from '../../types';
import { historyManager } from '../commands/HistoryManager';
import { AddNodeCommand, DeleteNodeCommand, UpdateNodeCommand, SetNodesCommand, MoveNodeCommand } from '../commands/nodeCommands';

// Simple UUID generator
const generateId = () => Math.random().toString(36).substring(2, 11);

interface CanvasStore {
  // State
  nodes: NodeData[];
  canvasState: CanvasState;
  
  // Actions - Nodes
  setNodes: (nodes: NodeData[], skipHistory?: boolean) => void;
  addNode: (node: NodeData, skipHistory?: boolean) => void;
  updateNode: (id: string, updates: Partial<NodeData>, skipHistory?: boolean) => void;
  moveNode: (id: string, oldPos: Point, newPos: Point) => void;
  deleteNode: (id: string) => void;
  deleteNodes: (ids: Set<string>) => void;

  // Actions - Canvas Transform
  setCanvasTransform: (offset: Point, scale: number) => void;
  resetCanvasView: () => void;

  // Actions - History (Undo/Redo)
  addToHistory: () => void; // Deprecated, kept for calling logic compat but effectively no-op or handled via commands
  undo: () => void;
  redo: () => void;

  // Actions - Node Reorder
  reorderNode: (id: string, direction: 'up' | 'down' | 'top' | 'bottom') => void;

  // Utility
  generateId: () => string;
}

const parsePersistedCanvasValue = (rawValue: unknown, storageKey: string) => {
  if (rawValue == null) return null;

  if (typeof rawValue === 'string') {
    try {
      const parsed = JSON.parse(rawValue);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
      console.warn(`[CanvasStore] Failed to parse persisted value for ${storageKey}`, error);
      return null;
    }
  }

  if (typeof rawValue === 'object') {
    return rawValue as Record<string, unknown>;
  }

  return null;
};

const canvasPersistStorage: PersistStorage<any> = {
  getItem: async (name) => {
    try {
      const rawValue = await get(name);
      const parsed = parsePersistedCanvasValue(rawValue, name);
      if (!parsed && rawValue != null) {
        await del(name);
      }
      return parsed;
    } catch (error) {
      console.warn(`[CanvasStore] Failed to read persisted state for ${name}`, error);
      try {
        await del(name);
      } catch (_) {}
      return null;
    }
  },
  setItem: async (name, value) => {
    try {
      await set(name, value);
    } catch (error) {
      console.warn(`[CanvasStore] Failed to persist state for ${name}`, error);
    }
  },
  removeItem: async (name) => {
    try {
      await del(name);
    } catch (error) {
      console.warn(`[CanvasStore] Failed to clear persisted state for ${name}`, error);
    }
  },
};

export const useCanvasStore = create<CanvasStore>()(
  persist(
    immer((set, get) => ({
      // Initial State
      nodes: [],
      canvasState: {
        offset: { x: typeof window !== 'undefined' ? window.innerWidth / 2 : 500, y: typeof window !== 'undefined' ? window.innerHeight / 2 : 400 },
        scale: 1,
      },

      // Actions - Nodes
      setNodes: (nodes, skipHistory = false) => {
        if (!skipHistory) {
             const command = new SetNodesCommand(nodes);
             historyManager.execute(command);
             // The command execution calls setNodes again, but we must ensure infinite loop prevention.
             // Actually, the command calls setNodes WITHOUT skipHistory? No, that would loop.
             // Command implementation: execute() { useCanvasStore.getState().setNodes(nodes) }
             // We need a lower-level setter or pass skipHistory=true in command.
        } else {
             set((state) => { state.nodes = nodes; });
        }
      },

      addNode: (node, skipHistory = false) => {
        if (!skipHistory) {
            const command = new AddNodeCommand(node);
            historyManager.execute(command);
        } else {
            set((state) => { state.nodes.push(node); });
        }
      },

      updateNode: (id, updates, skipHistory = false) => {
        if (!skipHistory) {
            const node = get().nodes.find(n => n.id === id);
            if (node) {
                 // Calculate old data for undo
                 const oldData: Partial<NodeData> = {};
                 (Object.keys(updates) as Array<keyof NodeData>).forEach(key => {
                     oldData[key] = node[key] as any;
                 });
                 const command = new UpdateNodeCommand(id, oldData, updates);
                 historyManager.execute(command);
            }
        } else {
            set((state) => {
              const index = state.nodes.findIndex((n) => n.id === id);
              if (index !== -1) {
                Object.assign(state.nodes[index], updates);
              }
            });
        }
      },

      moveNode: (id, oldPos, newPos) => {
          const command = new MoveNodeCommand(id, oldPos, newPos);
          historyManager.execute(command);
      },

      deleteNode: (id) => {
         const node = get().nodes.find(n => n.id === id);
         if (node) {
             const command = new DeleteNodeCommand([node]);
             historyManager.execute(command);
         }
      },

      deleteNodes: (ids) => {
         const nodesToDelete = get().nodes.filter(n => ids.has(n.id));
         if (nodesToDelete.length > 0) {
             const command = new DeleteNodeCommand(nodesToDelete);
             historyManager.execute(command);
         }
      },

      // Actions - Canvas Transform
      setCanvasTransform: (offset, scale) =>
        set((state) => {
          state.canvasState.offset = offset;
          state.canvasState.scale = scale;
        }),

      resetCanvasView: () =>
        set((state) => {
          state.canvasState = {
            offset: { x: window.innerWidth / 2, y: window.innerHeight / 2 },
            scale: 1,
          };
        }),

      // Actions - History (Undo/Redo)
      addToHistory: () => {
         // This is now legacy. The components call this believing it snapshots state.
         // Since we transitioned to atomic commands, "Snapshotting" is no longer the paradigm.
         // However, some actions (like DragEnd) call this separate from the update.
         // We might need to handle the "MoveNode" logic here if strictly necessary, 
         // BUT standardizing to use specific commands at the call site is better.
         console.warn("addToHistory called but store is using Command Pattern. Please migrate usage.");
      },

      undo: () => {
          historyManager.undo();
      },

      redo: () => {
          historyManager.redo();
      },

      // Actions - Node Reorder (TODO: Wrap in Command if needed)
      reorderNode: (id, direction) =>
        set((state) => {
          const index = state.nodes.findIndex((n) => n.id === id);
          if (index === -1) return;

          const [movedNode] = state.nodes.splice(index, 1);

          if (direction === 'up') {
            if (index < state.nodes.length) {
              state.nodes.splice(index + 1, 0, movedNode);
            } else {
              state.nodes.push(movedNode);
            }
          } else if (direction === 'down') {
            if (index > 0) {
              state.nodes.splice(index - 1, 0, movedNode);
            } else {
              state.nodes.unshift(movedNode);
            }
          } else if (direction === 'top') {
            state.nodes.push(movedNode);
          } else if (direction === 'bottom') {
            state.nodes.unshift(movedNode);
          }
        }),

      // Utility
      generateId,
    })),
    {
      name: 'infinitemuse-storage',
      storage: canvasPersistStorage,
      partialize: (state) => ({
        nodes: state.nodes,
        canvasState: state.canvasState
      }),
    }
  )
);
