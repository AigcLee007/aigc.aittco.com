const firstNonEmptyString = (...values) => {
  for (const value of values) {
    const normalized = String(value ?? "").trim();
    if (normalized) return normalized;
  }
  return "";
};

const extractVideoTaskId = (payload) => {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : null;
  return firstNonEmptyString(
    payload?.id,
    payload?.task_id,
    payload?.taskId,
    data?.id,
    data?.task_id,
    data?.taskId,
  );
};

const extractVideoTaskStatus = (payload) => {
  const data = payload?.data && typeof payload.data === "object" ? payload.data : null;
  return firstNonEmptyString(payload?.status, payload?.state, data?.status, data?.state).toUpperCase();
};

module.exports = {
  extractVideoTaskId,
  extractVideoTaskStatus,
};
