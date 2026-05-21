class TtlCache {
  constructor() { this._s = new Map(); }

  get(key) {
    const e = this._s.get(key);
    if (!e) return undefined;
    if (Date.now() > e.exp) { this._s.delete(key); return undefined; }
    return e.val;
  }

  set(key, val, ttlMs) {
    this._s.set(key, { val, exp: Date.now() + ttlMs });
  }

  clear(prefix) {
    for (const k of this._s.keys())
      if (!prefix || k.startsWith(prefix)) this._s.delete(k);
  }
}

module.exports = new TtlCache();
