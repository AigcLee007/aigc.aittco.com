const assert = require('assert');
const { getRedeemCodeStatus, matchesRedeemCodeSearch, normalizeRedeemCodeSearch } = require('./redeemCodePolicy.cjs');

describe('redeem code policy', () => {
  it('derives redeemed before disabled before active', () => {
    assert.equal(getRedeemCodeStatus({}), 'active');
    assert.equal(getRedeemCodeStatus({ disabledAt: '2026-09-09' }), 'disabled');
    assert.equal(getRedeemCodeStatus({ disabledAt: '2026-09-09', redeemedAt: '2026-09-10' }), 'redeemed');
    assert.equal(getRedeemCodeStatus({ disabled_at: '2026-09-09', redeemed_at: null }), 'disabled');
  });
  it('normalizes only the code search value', () => {
    assert.equal(normalizeRedeemCodeSearch(' nb12-ab cd '), 'NB12ABCD');
    assert.equal(matchesRedeemCodeSearch({ codeValue: 'NB12ABCD3456EFGH' }, 'nb12-abcd'), true);
    assert.equal(matchesRedeemCodeSearch({ code_value: 'NB12ABCD3456EFGH' }, 'ZZZZ'), false);
    assert.equal(matchesRedeemCodeSearch({ codeValue: 'NB12ABCD3456EFGH' }, ''), true);
  });
});
