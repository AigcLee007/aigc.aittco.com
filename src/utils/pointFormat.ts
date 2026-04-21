const POINT_DECIMALS = 1;
const POINT_SCALE = 10 ** POINT_DECIMALS;

export const roundPoint = (value: unknown, fallback = 0): number => {
  const parsed = Number.parseFloat(String(value ?? fallback));
  if (!Number.isFinite(parsed)) {
    const fallbackValue = Number(fallback || 0);
    return Number.isFinite(fallbackValue)
      ? Number(fallbackValue.toFixed(POINT_DECIMALS))
      : 0;
  }
  return Number((Math.round(parsed * POINT_SCALE) / POINT_SCALE).toFixed(POINT_DECIMALS));
};

export const roundNonNegativePoint = (value: unknown, fallback = 0): number =>
  Math.max(0, roundPoint(value, fallback));

export const roundPositivePoint = (value: unknown, fallback = 0): number => {
  const point = roundPoint(value, fallback);
  return point > 0 ? point : 0;
};

export const formatPoint = (value: unknown, fallback = 0): string =>
  roundPoint(value, fallback).toFixed(POINT_DECIMALS);

