import { useQuery } from '@tanstack/react-query';
import { getTaskStatusApi, findAllUrlsInObject, TaskStatusResponse } from '../../services/api';

export const useGenerationTask = (apiKey: string | null, taskId: string | undefined) => {
  return useQuery({
    queryKey: ['task', taskId],
    queryFn: async () => {
        if (!taskId) return null;
        const data = await getTaskStatusApi(apiKey || undefined, taskId);
        
        let statusRaw = (data.status || data.state || "").toUpperCase();
        
        // Deep search for status if top level is MISSING or UNKNOWN
        // (Copied logic from original geminiService)
         if (!statusRaw || statusRaw === "UNKNOWN") {
            const findStatusInObject = (obj: any): string | null => {
                if (!obj || typeof obj !== 'object') return null;
                if (obj.status && typeof obj.status === 'string') return obj.status;
                if (obj.state && typeof obj.state === 'string') return obj.state;
                if (obj.data && typeof obj.data === 'object') return findStatusInObject(obj.data);
                return null;
            };
            const inner = findStatusInObject(data);
            if (inner) statusRaw = inner.toUpperCase();
        }

        const isSuccess = statusRaw === 'SUCCESS' || statusRaw === 'SUCCEEDED' || statusRaw === 'COMPLETED';
        const isFailed = statusRaw === 'FAILURE' || statusRaw === 'FAILED';
        
        const resultUrls: string[] = [];
        if (isSuccess) {
            findAllUrlsInObject(data, resultUrls);
        }

        return {
            status: statusRaw,
            isSuccess,
            isFailed,
            urls: Array.from(new Set(resultUrls)),
            raw: data
        };
    },
    enabled: !!taskId,
    refetchInterval: (query) => {
        if (!query.state.data) return 2000;
        if (query.state.data.isSuccess || query.state.data.isFailed) return false;
        return 2000;
    },
    staleTime: 1000,
  });
};
