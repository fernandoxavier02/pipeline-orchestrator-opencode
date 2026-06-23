'use strict';

const BEGIN = '=== PIPELINE_AGENT_RESULT_V1 ===';
const END = '=== END PIPELINE_AGENT_RESULT_V1 ===';
const MAX_BODY_BYTES = 64 * 1024;
const setHas = Function.call.bind(Set.prototype.has);
const setValues = Function.call.bind(Set.prototype.values);

function readOnlySet(values) {
  const target = new Set(values);
  let proxy;
  proxy = new Proxy(target, {
    get(set, property) {
      if (property === 'add' || property === 'delete' || property === 'clear') {
        return () => { throw new TypeError('Cannot mutate read-only canonical set'); };
      }
      if (property === 'forEach') {
        return (callback, thisArg) => {
          if (typeof callback !== 'function') throw new TypeError('Callback must be a function');
          for (const value of setValues(set)) callback.call(thisArg, value, value, proxy);
        };
      }
      if (property === 'has') return (value) => setHas(set, value);
      if (property === 'size') return set.size;
      if (property === Symbol.iterator || property === 'values' || property === 'keys') {
        return function* iterateValues() {
          for (const value of setValues(set)) yield value;
        };
      }
      if (property === 'entries') {
        return function* iterateEntries() {
          for (const value of setValues(set)) yield [value, value];
        };
      }
      if (property === Symbol.toStringTag) return 'Set';
      return undefined;
    },
    set() {
      throw new TypeError('Cannot mutate read-only canonical set');
    },
    defineProperty() {
      throw new TypeError('Cannot mutate read-only canonical set');
    },
    deleteProperty() {
      throw new TypeError('Cannot mutate read-only canonical set');
    },
    setPrototypeOf() {
      throw new TypeError('Cannot mutate read-only canonical set');
    },
    preventExtensions() {
      throw new TypeError('Cannot mutate read-only canonical set');
    },
  });
  return proxy;
}

const VALID_STATUS = readOnlySet(['completed', 'awaiting_user_gate', 'failed']);

const KNOWN_KEYS = Object.freeze({
  status: 'string',
  summary: 'string',
  next_agent: 'string',
  findings: 'array',
  evidence: 'array',
  reason: 'string',
  detail: 'string',
  metrics: 'object',
  blocking: 'boolean',
});

function fail(error) {
  return { ok: false, status: 'failed', error: String(error || 'invalid result') };
}

function extractLastBlockBody(text) {
  if (typeof text !== 'string' || text.length === 0) return null;
  const endIdx = text.lastIndexOf(END);
  if (endIdx < 0) return null;
  const beginIdx = text.lastIndexOf(BEGIN, endIdx - 1);
  if (beginIdx < 0) return null;
  return text.slice(beginIdx + BEGIN.length, endIdx).replace(/^[\s\r\n]+|[\s\r\n]+$/g, '');
}

function decodeJsonStringToken(token) {
  try {
    return JSON.parse(`"${token}"`);
  } catch (_) {
    return token;
  }
}

function hasDuplicateTopLevelKey(jsonText) {
  const seen = new Set();
  let i = 0;
  let depth = 0;
  while (i < jsonText.length) {
    const ch = jsonText[i];
    if (ch === '"') {
      const start = i + 1;
      let j = start;
      let esc = false;
      while (j < jsonText.length) {
        const c = jsonText[j];
        if (esc) { esc = false; j += 1; continue; }
        if (c === '\\') { esc = true; j += 1; continue; }
        if (c === '"') break;
        j += 1;
      }
      const token = jsonText.slice(start, j);
      if (depth === 1) {
        let k = j + 1;
        while (k < jsonText.length && /\s/.test(jsonText[k])) k += 1;
        if (jsonText[k] === ':') {
          const key = decodeJsonStringToken(token);
          if (seen.has(key)) return true;
          seen.add(key);
        }
      }
      i = j + 1;
      continue;
    }
    if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') depth -= 1;
    i += 1;
  }
  return false;
}

function validateTypes(obj) {
  for (const key of Object.keys(obj)) {
    if (!Object.prototype.hasOwnProperty.call(KNOWN_KEYS, key)) return `unknown governance key: "${key}"`;
    const expected = KNOWN_KEYS[key];
    const value = obj[key];
    let okType;
    switch (expected) {
      case 'string': okType = typeof value === 'string'; break;
      case 'boolean': okType = typeof value === 'boolean'; break;
      case 'array': okType = Array.isArray(value); break;
      case 'object': okType = value && typeof value === 'object' && !Array.isArray(value); break;
      default: okType = false;
    }
    if (!okType) return `field "${key}" has wrong type (expected ${expected})`;
  }
  return null;
}

function parseResultBlock(text) {
  try {
    if (typeof text !== 'string' || text.length === 0) return fail('empty output - absence is never success');
    const body = extractLastBlockBody(text);
    if (body === null) return fail('no PIPELINE_AGENT_RESULT_V1 block found - absence is never success');
    if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) return fail('result block body exceeds size limit - rejected, not truncated');
    if (hasDuplicateTopLevelKey(body)) return fail('duplicate JSON key - ambiguous result refused');

    let obj;
    try {
      obj = JSON.parse(body);
    } catch (err) {
      return fail(`body is not valid JSON (never YAML/eval): ${err.message}`);
    }

    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return fail('result body must be a single JSON object');
    const typeError = validateTypes(obj);
    if (typeError) return fail(typeError);
    if (typeof obj.status !== 'string' || !VALID_STATUS.has(obj.status)) {
      return fail(`status "${obj.status}" is outside the closed vocabulary (completed|awaiting_user_gate|failed)`);
    }
    return Object.assign({ ok: true }, obj);
  } catch (err) {
    return fail(`parser error: ${err && err.message ? err.message : err}`);
  }
}

module.exports = {
  parseResultBlock,
  VALID_STATUS,
  KNOWN_KEYS,
  MAX_BODY_BYTES,
  BEGIN,
  END,
};
