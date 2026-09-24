const test = require('node:test');
const assert = require('node:assert/strict');
const logic = require('../public/probe-logic.js');

function raw(status, code, message = '') {
  return { status, body: JSON.stringify({ error: { code, message } }), latencyMs: 12 };
}

const calibration = { valid: true, sig: '400|1211' };

test('account billing failure is not a rate limit or model availability result', () => {
  const response = raw(429, '1113', '余额不足或无可用资源包');
  assert.equal(logic.classify('glm-x-preview-k', response, calibration).cls, 'billing');
  assert.equal(logic.shouldRetry(response), false);
  assert.equal(logic.classify('glm-x-preview-k', raw(429, '1302', '限流'), calibration).cls, 'unknown');
  assert.equal(logic.shouldRetry(raw(429, '1302', '限流')), true);
});

test('auth and generic gateway errors cannot become a nonexistent or locked baseline', () => {
  assert.equal(logic.classify('x', raw(401, '1000'), calibration).cls, 'unknown');
  assert.equal(logic.classify('x', raw(401, '1003'), calibration).cls, 'unknown');
  assert.equal(logic.classify('x', raw(403, 'other'), calibration).cls, 'unknown');
  assert.equal(logic.classify('x', raw(400, '1222', 'API 不存在'), calibration).cls, 'unknown');
  assert.equal(logic.classify('x', raw(500, '1234'), calibration).cls, 'unknown');
  assert.equal(logic.classify('x', raw(400, '1214', '输入不能为空'), calibration).cls, 'unknown');
  assert.equal(logic.classify('x', raw(400, '1211', '模型不存在'), calibration).cls, 'notfound');
});

test('account quotas are not retried as transient rate limits', () => {
  for (const code of ['1305', '1308', '1309', '1313']) {
    const response = raw(429, code, '使用上限');
    assert.equal(logic.classify('x', response, calibration).cls, 'unknown');
    assert.equal(logic.shouldRetry(response), false);
  }
});

test('empty-message control requires the same payload to separate missing and candidate', () => {
  assert.equal(logic.compareEmptyControl(raw(400, '1214'), raw(400, '1211')).verdict, 'recognized');
  assert.equal(logic.compareEmptyControl(raw(400, '1214'), raw(400, '1214')).verdict, 'inconclusive');
  assert.equal(logic.compareEmptyControl(raw(400, '1211'), raw(400, '1211')).verdict, 'notfound');
});
