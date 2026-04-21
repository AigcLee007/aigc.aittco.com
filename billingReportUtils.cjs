const { toPointNumber } = require("./pointMath.cjs");

const normalizeText = (value = "") => String(value || "").trim();

const parseBoundaryDate = (value, { endOfDay = false } = {}) => {
  const raw = normalizeText(value);
  if (!raw) return null;

  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? `${raw}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}`
    : raw;

  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return null;
  return date.getTime();
};

const getEntryMeta = (entry = {}) =>
  entry?.meta && typeof entry.meta === "object" ? entry.meta : {};

const getEntryCreatedAtMs = (entry = {}) => {
  const createdAt = normalizeText(entry.createdAt);
  if (!createdAt) return NaN;
  return new Date(createdAt).getTime();
};

const getEntryRouteValue = (entry = {}) => normalizeText(getEntryMeta(entry).routeId);

const getEntryRouteLabel = (entry = {}) => {
  const meta = getEntryMeta(entry);
  return (
    normalizeText(meta.routeLabel) ||
    normalizeText(meta.line) ||
    getEntryRouteValue(entry)
  );
};

const getEntryModelValue = (entry = {}) => {
  const meta = getEntryMeta(entry);
  return (
    normalizeText(meta.modelId) ||
    normalizeText(meta.model) ||
    normalizeText(meta.requestModel)
  );
};

const getEntryModelLabel = (entry = {}) => {
  const meta = getEntryMeta(entry);
  return (
    normalizeText(meta.modelLabel) ||
    normalizeText(meta.model) ||
    normalizeText(meta.requestModel) ||
    getEntryModelValue(entry)
  );
};

const addOption = (map, value, label) => {
  const nextValue = normalizeText(value);
  if (!nextValue) return;
  if (!map.has(nextValue)) {
    map.set(nextValue, normalizeText(label) || nextValue);
  }
};

const buildBillingLedgerReport = (entries = [], options = {}) => {
  const safePage = Math.max(1, Number.parseInt(String(options.page || 1), 10) || 1);
  const safePageSize = Math.min(
    100,
    Math.max(1, Number.parseInt(String(options.pageSize || 20), 10) || 20),
  );
  const normalizedType = normalizeText(options.type);
  const normalizedModelId = normalizeText(options.modelId);
  const normalizedRouteId = normalizeText(options.routeId);
  const startDateMs = parseBoundaryDate(options.startDate, { endOfDay: false });
  const endDateMs = parseBoundaryDate(options.endDate, { endOfDay: true });

  const sortedEntries = [...entries].sort((left, right) => {
    const rightTime = getEntryCreatedAtMs(right);
    const leftTime = getEntryCreatedAtMs(left);
    if (Number.isFinite(rightTime) || Number.isFinite(leftTime)) {
      if (rightTime !== leftTime) {
        return (Number.isFinite(rightTime) ? rightTime : 0) - (Number.isFinite(leftTime) ? leftTime : 0);
      }
    }
    return normalizeText(right.id).localeCompare(normalizeText(left.id));
  });

  const typeOptions = new Map();
  const modelOptions = new Map();
  const routeOptions = new Map();

  for (const entry of sortedEntries) {
    addOption(typeOptions, entry.type, entry.type);
    addOption(modelOptions, getEntryModelValue(entry), getEntryModelLabel(entry));
    addOption(routeOptions, getEntryRouteValue(entry), getEntryRouteLabel(entry));
  }

  const filteredEntries = sortedEntries.filter((entry) => {
    const createdAtMs = getEntryCreatedAtMs(entry);
    const entryType = normalizeText(entry.type);
    const entryModelId = getEntryModelValue(entry);
    const entryRouteId = getEntryRouteValue(entry);

    if (normalizedType && entryType !== normalizedType) return false;
    if (normalizedModelId && entryModelId !== normalizedModelId) return false;
    if (normalizedRouteId && entryRouteId !== normalizedRouteId) return false;
    if (Number.isFinite(startDateMs) && (!Number.isFinite(createdAtMs) || createdAtMs < startDateMs)) {
      return false;
    }
    if (Number.isFinite(endDateMs) && (!Number.isFinite(createdAtMs) || createdAtMs > endDateMs)) {
      return false;
    }
    return true;
  });

  const summary = {
    spentPoints: 0,
    rechargedPoints: 0,
    refundedPoints: 0,
    redeemedPoints: 0,
    totalCount: filteredEntries.length,
  };

  for (const entry of filteredEntries) {
    const points = toPointNumber(entry.points || 0);
    switch (normalizeText(entry.type)) {
      case "charge":
        summary.spentPoints = toPointNumber(summary.spentPoints + points, 0);
        break;
      case "recharge":
        summary.rechargedPoints = toPointNumber(summary.rechargedPoints + points, 0);
        break;
      case "refund":
        summary.refundedPoints = toPointNumber(summary.refundedPoints + points, 0);
        break;
      case "redeem_code":
        summary.redeemedPoints = toPointNumber(summary.redeemedPoints + points, 0);
        break;
      default:
        break;
    }
  }

  const offset = (safePage - 1) * safePageSize;

  return {
    summary,
    ledger: {
      total: filteredEntries.length,
      page: safePage,
      pageSize: safePageSize,
      totalPages: Math.max(1, Math.ceil(filteredEntries.length / safePageSize)),
      entries: filteredEntries.slice(offset, offset + safePageSize),
    },
    filters: {
      applied: {
        startDate: normalizeText(options.startDate) || null,
        endDate: normalizeText(options.endDate) || null,
        type: normalizedType || null,
        modelId: normalizedModelId || null,
        routeId: normalizedRouteId || null,
      },
      availableTypes: Array.from(typeOptions.entries()).map(([value, label]) => ({
        value,
        label,
      })),
      availableModels: Array.from(modelOptions.entries()).map(([value, label]) => ({
        value,
        label,
      })),
      availableRoutes: Array.from(routeOptions.entries()).map(([value, label]) => ({
        value,
        label,
      })),
    },
  };
};

module.exports = {
  buildBillingLedgerReport,
};
