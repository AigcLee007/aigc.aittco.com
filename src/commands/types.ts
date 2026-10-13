import { NodeData } from '../../types';
import { useCanvasStore } from '../store/canvasStore';

export interface Command {
    execute: () => void;
    undo: () => void;
    timestamp?: number;
    getAssetIds?: () => string[];
    getAssetSources?: () => string[];
}

export interface CommandManager {
    execute: (command: Command) => void;
    undo: () => void;
    redo: () => void;
    clear: () => void;
    canUndo: () => boolean;
    canRedo: () => boolean;
}
