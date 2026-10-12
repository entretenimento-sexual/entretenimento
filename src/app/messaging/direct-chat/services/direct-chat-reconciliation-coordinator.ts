/** Deduplica reconciliações de projeção por par, sem conceder acesso. */
export class DirectChatReconciliationCoordinator {
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly lastAttempt = new Map<string, number>();
  private readonly retryAfterMs = 60_000;
  private readonly maxAttemptEntries = 256;

  run(owner: string, peer: string, request: () => Promise<unknown>): Promise<void> {
    const key = JSON.stringify([owner, peer]);
    const active = this.inFlight.get(key);
    if (active) return active;

    const now = Date.now();
    if (now - (this.lastAttempt.get(key) ?? -Infinity) < this.retryAfterMs) {
      return Promise.resolve();
    }
    for (const [entry, attemptedAt] of this.lastAttempt) {
      if (now - attemptedAt >= this.retryAfterMs) this.lastAttempt.delete(entry);
    }
    if (this.lastAttempt.size >= this.maxAttemptEntries) {
      const oldest = this.lastAttempt.keys().next().value;
      if (oldest !== undefined) this.lastAttempt.delete(oldest);
    }
    this.lastAttempt.set(key, now);

    const pending = Promise.resolve().then(request).then(
      () => undefined,
      () => undefined
    );
    this.inFlight.set(key, pending);
    void pending.finally(() => {
      if (this.inFlight.get(key) === pending) this.inFlight.delete(key);
    });
    return pending;
  }
}
