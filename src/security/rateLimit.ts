export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

/**
 * In-process sliding window limiter. `consume` is synchronous, so overlapping
 * calls on the same thread cannot pass the limit together.
 * Expired keys are dropped once the map grows, which keeps a scan of many
 * addresses from retaining every address forever.
 */
export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  /**
   * @param limit - Maximum accepted calls per key inside the window.
   * @param windowMs - Window length in milliseconds.
   * @param now - Clock, injectable so tests do not sleep.
   */
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Records one attempt for `key`.
   *
   * @param key - Caller identity, usually the socket address.
   * @returns Whether the attempt is inside the budget and how long a rejection should wait.
   */
  consume(key: string): RateLimitDecision {
    const current = this.now();
    const fresh = (this.hits.get(key) ?? []).filter((stamp) => current - stamp < this.windowMs);
    if (fresh.length >= this.limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil((fresh[0] + this.windowMs - current) / 1000));
      this.hits.set(key, fresh);
      return { allowed: false, retryAfterSeconds };
    }
    fresh.push(current);
    this.hits.set(key, fresh);
    this.prune(current);
    return { allowed: true, retryAfterSeconds: 0 };
  }

  private prune(current: number): void {
    if (this.hits.size < 1024) {
      return;
    }
    for (const [key, stamps] of this.hits) {
      const fresh = stamps.filter((stamp) => current - stamp < this.windowMs);
      if (fresh.length === 0) {
        this.hits.delete(key);
      } else {
        this.hits.set(key, fresh);
      }
    }
  }
}
