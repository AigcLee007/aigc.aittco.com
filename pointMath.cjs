const POINT_DECIMALS = 1;
const POINT_SCALE = 10 ** POINT_DECIMALS;

const toPointNumber = (value, fallback = 0) => {
  const parsed = Number.parseFloat(String(value ?? fallback));
  if (!Number.isFinite(parsed)) {
    return Number.parseFloat(Number(fallback || 0).toFixed(POINT_DECIMALS));
  }
  return Number.parseFloat((Math.round(parsed * POINT_SCALE) / POINT_SCALE).toFixed(POINT_DECIMALS));
};

const toSignedPoint = (value, fallback = 0) => toPointNumber(value, fallback);

const toNonNegativePoint = (value, fallback = 0) => {
  const next = toPointNumber(value, fallback);
  return next >= 0 ? next : 0;
};

const toPositivePoint = (value, fallback = 0) => {
  const next = toPointNumber(value, fallback);
  return next > 0 ? next : 0;
};

const formatPointFixed = (value) => toPointNumber(value, 0).toFixed(POINT_DECIMALS);

module.exports = {
  POINT_DECIMALS,
  POINT_SCALE,
  formatPointFixed,
  toNonNegativePoint,
  toPointNumber,
  toPositivePoint,
  toSignedPoint,
};
