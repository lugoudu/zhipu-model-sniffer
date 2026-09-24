/* Response interpretation is deliberately conservative: a gateway error does
 * not establish that a model is deployed or close to public release. */
((root, factory) => {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ProbeLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  function errorOf(raw) {
    let body;
    try { body = JSON.parse(raw.body); } catch { body = null; }
    const err = body && body.error ? body.error : {};
    return {
      code: err.code == null ? '' : String(err.code),
      message: err.message == null ? '' : String(err.message),
    };
  }

  function signature(raw) {
    return `${raw.status}|${errorOf(raw).code}`;
  }

  function isMissing(raw) {
    const err = errorOf(raw);
    return err.code === '1211' || /模型不存在|no such model|does not exist/i.test(err.message);
  }

  function isBilling(raw) {
    const err = errorOf(raw);
    return err.code === '1113' || /余额不足|无可用资源包|insufficient balance|no resource package/i.test(err.message);
  }

  function isRateLimit(raw) {
    const err = errorOf(raw);
    const accountLimits = ['1305', '1308', '1309', '1313'];
    return !isBilling(raw) && !accountLimits.includes(err.code) &&
      (err.code === '1302' || (raw.status === 429 && !err.code) || /限流|rate limit|too many requests/i.test(err.message));
  }

  function shouldRetry(raw) {
    return raw.status === 0 || isRateLimit(raw);
  }

  function classify(model, raw, calibration) {
    const err = errorOf(raw);
    const text = `${err.code} ${err.message}`;
    const base = {
      model, status: raw.status, code: err.code, msg: err.message,
      latencyMs: raw.latencyMs, ts: Date.now(), sig: signature(raw),
      rawBody: String(raw.body || '').slice(0, 2000),
    };
    if (raw.status === 200) return { ...base, cls: 'open' };
    if (raw.status === 0) return { ...base, cls: 'unknown', note: '网络错误或超时' };
    if (raw.status === 401 || ['1000', '1001', '1003'].includes(err.code))
      return { ...base, cls: 'unknown', note: 'Key 无效或已过期', keyInvalid: true };
    if (['1221', '1222'].includes(err.code))
      return { ...base, cls: 'unknown', note: 'API 级错误，不用于判定模型名称' };
    if (err.code === '1234' || raw.status >= 500)
      return { ...base, cls: 'unknown', note: '平台侧错误，不用于判定模型名称' };
    if (isMissing(raw) || (calibration && calibration.valid && base.sig === calibration.sig))
      return { ...base, cls: 'notfound' };
    if (['1213', '1220', '1311'].includes(err.code) || /无权访问|没有权限|permission denied|access denied|not authorized/i.test(text))
      return { ...base, cls: 'locked', note: '该 Key 在此接口被拒访问；无法据此判断发布时间' };
    if (isBilling(raw))
      return { ...base, cls: 'billing', note: '计费或资源资格受阻；需结合相同 Key 的付费模型对照' };
    if (isRateLimit(raw))
      return { ...base, cls: 'unknown', note: '限流，稍后重试' };
    if (['1305', '1308', '1309', '1313'].includes(err.code))
      return { ...base, cls: 'unknown', note: '账号用量或套餐限制，不用于判定模型名称' };
    if (err.code === '1212' || /不支持该接口|不适用于此接口|unsupported endpoint|not supported by this endpoint/i.test(text))
      return { ...base, cls: 'likely', note: '接口不匹配信号；仍需同载荷乱名对照' };
    return { ...base, cls: 'unknown', note: '该错误尚不足以判断名称是否被识别' };
  }

  function compareEmptyControl(candidate, missing) {
    const candidateError = errorOf(candidate);
    if (errorOf(missing).code !== '1211') return { verdict: 'inconclusive', note: '乱名在空消息下未返回 1211，无法确认校验顺序' };
    if (isMissing(candidate)) return { verdict: 'notfound', note: '候选与乱名均返回名称不存在' };
    if (candidateError.code === '1214')
      return { verdict: 'recognized', note: '同一空载荷下乱名返回 1211、候选返回 1214；说明网关区别处理该名称，不证明推理后端可用' };
    return { verdict: 'inconclusive', note: '空消息对照未形成可解释的 1211/1214 差异' };
  }

  return { errorOf, signature, isMissing, isBilling, isRateLimit, shouldRetry, classify, compareEmptyControl };
});
