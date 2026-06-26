const SUCCESS_STATUSES = new Set(["SUCCEEDED", "SUCCESS", "COMPLETED"]);

const normalizeStatus = (value = "") => String(value || "").trim().toUpperCase();

const buildVisionaryPollingJobPatch = ({
  record = {},
  localTaskId = "",
  upstreamTaskId = "",
} = {}) => {
  const status = normalizeStatus(record.status || record.state);
  const upstreamSucceeded = SUCCESS_STATUSES.has(status);
  const progress = Number(record.progress);

  return {
    upstreamTaskId,
    status: upstreamSucceeded ? "processing" : String(record.status || "processing").toLowerCase(),
    progress: upstreamSucceeded ? Math.max(Number.isFinite(progress) ? progress : 0, 99) : record.progress ?? 0,
    responseData: {
      id: localTaskId,
      task_id: localTaskId,
      upstream_id: upstreamTaskId,
      status: upstreamSucceeded ? "processing" : record.status || "processing",
      progress: upstreamSucceeded ? Math.max(Number.isFinite(progress) ? progress : 0, 99) : record.progress ?? 0,
      results: upstreamSucceeded ? [] : record.results || [],
      error: "",
      failure_reason: "",
    },
  };
};

module.exports = {
  buildVisionaryPollingJobPatch,
};
