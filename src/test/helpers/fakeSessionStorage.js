/**
 * A stand-in for the browser's sessionStorage that remembers every call, so a
 * test can say "nothing touched storage" and mean it, and can make any call
 * fail.
 */
export class FakeSessionStorage {
  constructor({ failOn = [] } = {}) {
    this.map = new Map();
    this.failOn = new Set(failOn);
    this.log = [];
  }

  #maybeFail(name) {
    this.log.push(name);
    if (this.failOn.has(name)) throw Object.assign(new Error(`${name} refused`), { name: name === 'setItem' ? 'QuotaExceededError' : 'SecurityError' });
  }

  get length() { this.#maybeFail('length'); return this.map.size; }
  key(index) { this.#maybeFail('key'); return [...this.map.keys()][index] ?? null; }
  getItem(key) { this.#maybeFail('getItem'); return this.map.has(key) ? this.map.get(key) : null; }
  setItem(key, value) { this.#maybeFail('setItem'); this.map.set(key, String(value)); }
  removeItem(key) { this.#maybeFail('removeItem'); this.map.delete(key); }

  /** How many calls have been made, optionally of one kind. */
  calls(name) { return name ? this.log.filter((entry) => entry === name).length : this.log.length; }
}

export default FakeSessionStorage;
