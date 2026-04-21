import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HistoryManager } from '../HistoryManager';
import { Command } from '../types';

// Mock Command
class MockCommand implements Command {
    execute = vi.fn();
    undo = vi.fn();
}

describe('HistoryManager', () => {
    let historyManager: HistoryManager;

    beforeEach(() => {
        historyManager = new HistoryManager();
    });

    it('should execute a command and add it to history', () => {
        const command = new MockCommand();
        historyManager.execute(command);

        expect(command.execute).toHaveBeenCalled();
        expect(historyManager.canUndo()).toBe(true);
        expect(historyManager.canRedo()).toBe(false);
    });

    it('should undo a command', () => {
        const command = new MockCommand();
        historyManager.execute(command);
        historyManager.undo();

        expect(command.undo).toHaveBeenCalled();
        expect(historyManager.canUndo()).toBe(false);
        expect(historyManager.canRedo()).toBe(true);
    });

    it('should redo a command', () => {
        const command = new MockCommand();
        historyManager.execute(command);
        historyManager.undo();
        historyManager.redo();

        expect(command.execute).toHaveBeenCalledTimes(2); // Initial + Redo
        expect(historyManager.canUndo()).toBe(true);
        expect(historyManager.canRedo()).toBe(false);
    });

    it('should clear future when a new command is executed', () => {
        const command1 = new MockCommand();
        const command2 = new MockCommand();
        
        historyManager.execute(command1);
        historyManager.undo(); // Future has command1
        
        historyManager.execute(command2); // Should clear future

        expect(historyManager.canRedo()).toBe(false);
    });
});
