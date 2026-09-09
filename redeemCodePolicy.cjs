const normalizeRedeemCodeSearch = (value = '') =>
  String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').trim();

const getRedeemCodeStatus = (entry = {}) => {
  if (entry.redeemedAt || entry.redeemed_at) return 'redeemed';
  if (entry.disabledAt || entry.disabled_at) return 'disabled';
  return 'active';
};

const matchesRedeemCodeSearch = (entry = {}, search = '') => {
  const needle = normalizeRedeemCodeSearch(search);
  if (!needle) return true;
  return normalizeRedeemCodeSearch(entry.codeValue || entry.code_value || entry.code || '').includes(needle);
};

module.exports = { getRedeemCodeStatus, matchesRedeemCodeSearch, normalizeRedeemCodeSearch };
