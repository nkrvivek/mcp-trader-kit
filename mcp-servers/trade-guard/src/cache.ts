export interface CacheEntry<T> { value: T; expires: number; }

export class TtlCache<T> {
  private store = new Map<string, CacheEntry<T>>();
  constructor(private readonly ttlMs: number) {}
  get(key: string): T | null {
    const e = this.store.get(key);
    if (!e) return null;
    if (Date.now() > e.expires) { this.store.delete(key); return null; }
    return e.value;
  }
  set(key: string, value: T): void {
    this.store.set(key, { value, expires: Date.now() + this.ttlMs });
  }
  clear(): void { this.store.clear(); }
}
