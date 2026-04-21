import { NodeData } from '../../types';
import { useCanvasStore } from '../store/canvasStore';

export interface Command {
    execute: () => void;
    undo: () => void;
    timestamp?: number;
}

export interface CommandManager {
    execute: (command: Command) => void;
    undo: () => void;
    redo: () => void;
    clear: () => void;
    canUndo: () => boolean;
    canRedo: () => boolean;
}
