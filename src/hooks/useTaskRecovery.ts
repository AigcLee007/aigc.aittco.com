import { useCanvasStore } from "../store/canvasStore";
import { useHistoryStore } from "../store/historyStore";
import { pollVideoTask } from "../services/videoService";

/**
 * DEPRECATED: This hook has been replaced by useGlobalPolling
 * Keeping it disabled to prevent duplicate API requests that cause rate limiting
 */
export const useTaskRecovery = (apiKey: string | undefined) => {
  // DISABLED: useGlobalPolling now handles all task polling and recovery
  // Enabling this causes "Too many requests" errors due to duplicate polling
  
  /*
  useEffect(() => {
    const recoverTasks = async () => {
      // Find all nodes that are loading AND have a taskId
      const pendingNodes = useCanvasStore
        .getState()
        .nodes.filter(
          (n) =>
            (n.type === "IMAGE" || n.type === "VIDEO") && n.loading && n.taskId,
        );

      if (pendingNodes.length === 0) return;

      console.log(
        `[Task Recovery] Found ${pendingNodes.length} pending tasks.`,
      );

      pendingNodes.forEach(async (node) => {
        if (!apiKey) return;

        try {
          let resultUrl = "";
          if (node.type === "IMAGE") {
            resultUrl = await pollImageTask(apiKey, node.taskId!);
            useHistoryStore
              .getState()
              .addLog("Recovered image task", "success");
          } else if (node.type === "VIDEO") {
            resultUrl = await pollVideoTask(apiKey, node.taskId!);
            useHistoryStore
              .getState()
              .addLog("Recovered video task", "success");
          }

          if (resultUrl) {
            const { updateNode } = useCanvasStore.getState();

            // Add to history
            useHistoryStore
              .getState()
              .addLog(node.prompt || "Recovered Task", resultUrl);

            updateNode(
              node.id,
              {
                src: resultUrl,
                loading: false,
                taskId: undefined,
                error: false,
              },
              true,
            );
          }
        } catch (error: any) {
          console.error(`[Recovery] Failed for node ${node.id}`, error);
          useCanvasStore.getState().updateNode(node.id, {
            loading: false,
            error: true,
            errorMessage: error.message || "恢复失败",
          });
        }
      });
    };

    if (apiKey) {
      recoverTasks();
    }
  }, [apiKey]);
  */
};
