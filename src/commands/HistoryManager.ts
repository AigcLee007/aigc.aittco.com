import { Command, CommandManager } from './types';

export class HistoryManager implements CommandManager {
    private history: Command[] = [];
    private future: Command[] = [];
    private maxHistory: number;

    constructor(maxHistory: number = 50) {
        this.maxHistory = maxHistory;
    }

    execute(command: Command) {
        command.execute();
        this.history.push(command);
        this.future = []; // Clear redo stack on new action
        
        if (this.history.length > this.maxHistory) {
            this.history.shift();
        }
    }

    undo() {
        if (this.history.length === 0) return;
        const command = this.history.pop();
        if (command) {
            command.undo();
            this.future.push(command);
        }
    }

    redo() {
        if (this.future.length === 0) return;
        const command = this.future.pop();
        if (command) {
            command.execute();
            this.history.push(command);
        }
    }

    clear() {
        this.history = [];
        this.future = [];
    }

    canUndo(): boolean {
        return this.history.length > 0;
    }

    canRedo(): boolean {
        return this.future.length > 0;
    }
}

export const historyManager = new HistoryManager();
