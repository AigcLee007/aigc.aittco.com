import { NodeData } from '../../types';

interface LayoutOptions {
    cols?: number;
    gap?: number;
    startX?: number;
    startY?: number;
    nodeWidth?: number;
    nodeHeight?: number;
    maxRows?: number; // New option for fixed rows
}

/**
 * Arranges image nodes in a grid layout.
 * Sorts nodes by creation time (newest first).
 * 
 * @param nodes The current list of nodes.
 * @param options Layout configuration options.
 * @returns A new list of nodes with updated positions for unlocked images.
 */
export const arrangeNodes = (nodes: NodeData[], options: LayoutOptions = {}): NodeData[] => {
    const {
        cols: manualCols,
        gap = 20, // Compact gap default
        startX = 0,
        startY = 0,
        nodeWidth = 512,
        nodeHeight = 512,
        maxRows // If set, we use fixed rows and expand horizontally
    } = options;

    // Helper to arrange a group of nodes
    const layoutGroup = (groupNodes: NodeData[], initialX: number, initialY: number): { nodes: NodeData[], maxWidth: number } => {
        if (groupNodes.length === 0) return { nodes: [], maxWidth: 0 };

        // Keep strict creation order
        const sortedNodes = [...groupNodes];

        interface ColumnState {
            x: number;
            currentY: number;
            maxWidth: number;
        }

        const columns: ColumnState[] = [];
        let groupMaxX = 0;

        const updatedGroup = sortedNodes.map((node, index) => {
            let x, y;

            if (maxRows) {
                // Horizontal Stream Mode
                const colIndex = Math.floor(index / maxRows);

                // Initialize column if needed
                if (!columns[colIndex]) {
                    let thisColX = initialX;
                    if (colIndex > 0) {
                        const prevCol = columns[colIndex - 1];
                        thisColX = prevCol.x + prevCol.maxWidth + gap;
                    }
                    columns[colIndex] = {
                        x: thisColX,
                        currentY: initialY,
                        maxWidth: 0
                    };
                }

                const colState = columns[colIndex];
                x = colState.x;
                y = colState.currentY;

                colState.currentY += node.height + gap;
                if (node.width > colState.maxWidth) {
                    colState.maxWidth = node.width;
                }

                if (x + colState.maxWidth > groupMaxX) {
                    groupMaxX = x + colState.maxWidth;
                }

            } else {
                // Fallback Standard Grid
                let cols = manualCols || 4;
                const col = index % cols;
                const row = Math.floor(index / cols);
                x = initialX + col * (nodeWidth + gap);
                y = initialY + row * (nodeHeight + gap);

                const currentRight = x + node.width;
                if (currentRight > groupMaxX) groupMaxX = currentRight;
            }

            return { ...node, x, y };
        });

        // If fallback grid used, accurate groupMaxX needs calculation or just max x found. 
        // Logic above handles it roughly.

        return { nodes: updatedGroup, maxWidth: groupMaxX - initialX };
    };

    // Separate nodes
    const lockedOrOtherNodes = nodes.filter(n => (n.type !== 'IMAGE' && n.type !== 'VIDEO') || n.locked);
    const imageNodes = nodes.filter(n => n.type === 'IMAGE' && !n.locked);
    const videoNodes = nodes.filter(n => n.type === 'VIDEO' && !n.locked);

    // Layout Images
    const { nodes: arrangedImages, maxWidth: imageWidth } = layoutGroup(imageNodes, startX, startY);

    // Layout Videos (Start after images + gap)
    // If no images, start at startX
    const sectionGap = 100; // Gap between Image Section and Video Section
    const videoStartX = imageNodes.length > 0 ? (startX + imageWidth + sectionGap) : startX;

    const { nodes: arrangedVideos } = layoutGroup(videoNodes, videoStartX, startY);

    // Combine back
    return [...lockedOrOtherNodes, ...arrangedImages, ...arrangedVideos];
};
