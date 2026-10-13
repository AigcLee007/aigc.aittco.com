import { Command } from './types';
import { useCanvasStore } from '../store/canvasStore';
import { NodeData } from '../../types';
const assetIds = (node: Partial<NodeData>): string[] => [node.assetId, ...(node.history || []).map(item => item.assetId)].filter((id): id is string => Boolean(id));
const assetSources = (node: Partial<NodeData>): string[] => [node.src, ...(node.history || []).map(item => item.src)].filter((src): src is string => Boolean(src));

export class AddNodeCommand implements Command {
    getAssetIds() { return assetIds(this.node); }
    getAssetSources() { return assetSources(this.node); }
    private node: NodeData;

    constructor(node: NodeData) {
        this.node = node;
    }

    execute() {
        // Must skip history to avoid infinite loop (ACTION -> COMMAND -> ACTION -> COMMAND...)
        useCanvasStore.getState().setNodes([...useCanvasStore.getState().nodes, this.node], true);
    }

    undo() {
        useCanvasStore.getState().setNodes(useCanvasStore.getState().nodes.filter(n => n.id !== this.node.id), true);
    }
}

export class DeleteNodeCommand implements Command {
    getAssetIds() { return this.nodesToDelete.flatMap(assetIds); }
    getAssetSources() { return this.nodesToDelete.flatMap(assetSources); }
    private nodesToDelete: NodeData[];

    constructor(nodesToDelete: NodeData[]) {
        this.nodesToDelete = nodesToDelete;
    }

    execute() {
        const ids = new Set(this.nodesToDelete.map(n => n.id));
        useCanvasStore.getState().setNodes(useCanvasStore.getState().nodes.filter(n => !ids.has(n.id)), true);
    }

    undo() {
        useCanvasStore.getState().setNodes([...useCanvasStore.getState().nodes, ...this.nodesToDelete], true);
    }
}

export class MoveNodeCommand implements Command {
    private nodeId: string;
    private oldPos: { x: number, y: number };
    private newPos: { x: number, y: number };

    constructor(nodeId: string, oldPos: { x: number, y: number }, newPos: { x: number, y: number }) {
        this.nodeId = nodeId;
        this.oldPos = oldPos;
        this.newPos = newPos;
    }

    execute() {
        const { nodes, setNodes } = useCanvasStore.getState();
        const newNodes = nodes.map(n => n.id === this.nodeId ? { ...n, ...this.newPos } : n);
        setNodes(newNodes, true);
    }

    undo() {
        const { nodes, setNodes } = useCanvasStore.getState();
        const newNodes = nodes.map(n => n.id === this.nodeId ? { ...n, ...this.oldPos } : n);
        setNodes(newNodes, true);
    }
}

export class UpdateNodeCommand implements Command {
    getAssetIds() { return [...assetIds(this.oldData), ...assetIds(this.newData)]; }
    getAssetSources() { return [...assetSources(this.oldData), ...assetSources(this.newData)]; }
    private nodeId: string;
    private oldData: Partial<NodeData>;
    private newData: Partial<NodeData>;

    constructor(nodeId: string, oldData: Partial<NodeData>, newData: Partial<NodeData>) {
        this.nodeId = nodeId;
        this.oldData = oldData;
        this.newData = newData;
    }

    execute() {
        // updateNode signature: (id, updates, skipHistory)
        useCanvasStore.getState().updateNode(this.nodeId, this.newData, true);
    }

    undo() {
        useCanvasStore.getState().updateNode(this.nodeId, this.oldData, true);
    }
}

export class SetNodesCommand implements Command {
    getAssetIds() { return [...this.oldNodes, ...this.newNodes].flatMap(assetIds); }
    getAssetSources() { return [...this.oldNodes, ...this.newNodes].flatMap(assetSources); }
    private newNodes: NodeData[];
    private oldNodes: NodeData[];

    constructor(newNodes: NodeData[]) {
        this.newNodes = newNodes;
        this.oldNodes = useCanvasStore.getState().nodes;
    }

    execute() {
        useCanvasStore.getState().setNodes(this.newNodes, true);
    }

    undo() {
        useCanvasStore.getState().setNodes(this.oldNodes, true);
    }
}
