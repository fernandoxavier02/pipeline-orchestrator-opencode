'use strict';

const SCHEMA_VERSION = '1';
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

const CANONICAL_DECISIONS = readOnlySet([
  'BLOCKED',
  'DISPATCHED',
  'SKIPPED',
  'APPROVED',
  'CONFIRMED',
  'REJECTED',
  'TRIGGERED',
  'NOT_TRIGGERED',
]);

const CANONICAL_HARDNESS = readOnlySet([
  'MANDATORY',
  'HARD',
  'CIRCUIT_BREAKER',
  'SOFT',
  'AUDIT',
]);

const BASE_GATE_DECISION_KEYS = Object.freeze([
  'gate', 'hardness', 'phase', 'decision', 'decided_by',
  'timestamp', 'detail', 'confidence_impact',
]);

const CORRELATION_KEYS = Object.freeze([
  'run_id', 'plugin_version', 'schema_version', 'type', 'complexity',
]);

const ALLOWED_GATE_DECISION_KEYS = Object.freeze([
  ...BASE_GATE_DECISION_KEYS,
  ...CORRELATION_KEYS,
]);

function isCanonicalDecision(decision) {
  return typeof decision === 'string' && CANONICAL_DECISIONS.has(decision);
}

function isCanonicalHardness(hardness) {
  return typeof hardness === 'string' && CANONICAL_HARDNESS.has(hardness);
}

module.exports = {
  SCHEMA_VERSION,
  CANONICAL_DECISIONS,
  CANONICAL_HARDNESS,
  BASE_GATE_DECISION_KEYS,
  CORRELATION_KEYS,
  ALLOWED_GATE_DECISION_KEYS,
  isCanonicalDecision,
  isCanonicalHardness,
};
