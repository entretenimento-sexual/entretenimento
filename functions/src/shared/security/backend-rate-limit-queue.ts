/**
 * Limits local transaction contention without sharing permits. Every accepted
 * job runs independently; the Firestore transaction remains the authority.
 * Waiting jobs may expire, but a running transaction is never abandoned.
 */
export class BackendRateLimitQueueBusyError extends Error {
  constructor() {
    super('Fila local de rate limit temporariamente ocupada.');
    this.name = 'BackendRateLimitQueueBusyError';
  }
}

export class BackendRateLimitQueue {
  private readonly queues = new Map<string, Array<() => void>>();

  constructor(
    private readonly maxWaitingPerKey = 16,
    private readonly maxActiveKeys = 2_048,
    private readonly waitTimeoutMs = 5_000
  ) {}

  run<T>(key: string, work: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const existing = this.queues.get(key);
      if (
        (existing && existing.length >= this.maxWaitingPerKey)
        || (!existing && this.queues.size >= this.maxActiveKeys)
      ) {
        reject(new BackendRateLimitQueueBusyError());
        return;
      }

      const waiting = existing ?? [];
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const start = (): void => {
        if (timeout !== undefined) clearTimeout(timeout);
        void Promise.resolve().then(work).then(resolve, reject).finally(() => {
          const next = waiting.shift();
          if (next) {
            next();
          } else {
            this.queues.delete(key);
          }
        });
      };

      if (!existing) {
        this.queues.set(key, waiting);
        start();
        return;
      }

      waiting.push(start);
      timeout = setTimeout(() => {
        const index = waiting.indexOf(start);
        if (index < 0) return;
        waiting.splice(index, 1);
        reject(new BackendRateLimitQueueBusyError());
      }, this.waitTimeoutMs);
    });
  }
}
