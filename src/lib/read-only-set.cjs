'use strict';

const setHas = Function.call.bind(Set.prototype.has);
const setValues = Function.call.bind(Set.prototype.values);

function readOnlySet(values) {
  const target = new Set(values);
  let proxy;
  proxy = new Proxy(target, {
    get(set, property) {
      if (property === 'add' || property === 'delete' || property === 'clear') {
        return () => { throw new TypeError('Cannot mutate read-only set'); };
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
    set() { throw new TypeError('Cannot mutate read-only set'); },
    defineProperty() { throw new TypeError('Cannot mutate read-only set'); },
    deleteProperty() { throw new TypeError('Cannot mutate read-only set'); },
    setPrototypeOf() { throw new TypeError('Cannot mutate read-only set'); },
    preventExtensions() { throw new TypeError('Cannot mutate read-only set'); },
  });
  return proxy;
}

module.exports = { readOnlySet, setHas };
