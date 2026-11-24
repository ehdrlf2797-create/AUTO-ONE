(function (root) {
  'use strict';

  function createAccountStorage(options) {
    if (!options || !options.storage || typeof options.storage.getItem !== 'function' ||
        typeof options.storage.setItem !== 'function' || typeof options.storage.removeItem !== 'function') {
      throw new TypeError('A Storage-compatible object is required.');
    }
    const storage = options.storage;
    const scopedKeys = new Set(Array.isArray(options.scopedKeys) ? options.scopedKeys : []);
    const seenKey = String(options.seenKey || 'lucky645_account_scope_seen_v1');
    const getCurrentUserId = typeof options.getCurrentUserId === 'function'
      ? options.getCurrentUserId
      : () => null;

    function key(name, userId) {
      if (!scopedKeys.has(name)) return name;
      const owner = userId || getCurrentUserId() || 'local';
      return name + '::' + String(owner);
    }

    function activate(userId) {
      if (!userId) return false;
      let seen = [];
      try {
        const parsed = JSON.parse(storage.getItem(seenKey) || '[]');
        if (Array.isArray(parsed)) seen = parsed.filter(value => typeof value === 'string');
      } catch (_) {}
      if (seen.includes(String(userId))) return false;

      // Only the first account may adopt legacy anonymous data.
      if (seen.length === 0) {
        let migrationSucceeded = true;
        for (const name of scopedKeys) {
          const target = key(name, String(userId));
          try {
            if (storage.getItem(target) === null) {
              const legacy = storage.getItem(name);
              if (legacy !== null) storage.setItem(target, legacy);
            }
            storage.removeItem(name);
          } catch (_) {
            migrationSucceeded = false;
          }
        }
        if (!migrationSucceeded) return false;
      }

      seen.push(String(userId));
      try {
        storage.setItem(seenKey, JSON.stringify([...new Set(seen)]));
      } catch (_) {}
      return true;
    }

    return Object.freeze({
      key,
      activate,
      get: name => storage.getItem(key(name)),
      set: (name, value) => storage.setItem(key(name), value),
      remove: name => storage.removeItem(key(name))
    });
  }

  root.Lucky645Storage = Object.freeze({ createAccountStorage });
})(typeof window !== 'undefined' ? window : globalThis);
