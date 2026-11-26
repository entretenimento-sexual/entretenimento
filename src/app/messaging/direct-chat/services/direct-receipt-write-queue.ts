import { Observable, Subscriber, defer } from 'rxjs';

interface ReceiptJob {
  start(): void;
}

// FIFO across all receipt batches in this service instance. Queued jobs
// contain only the caller's deferred work; no independent session or retry.
export class DirectReceiptWriteQueue {
  private readonly queue: ReceiptJob[] = [];
  private active = 0;
  private draining = false;
  private drainScheduled = false;

  constructor(private readonly concurrency: number, private readonly maxQueued: number) {}

  schedule$<T>(work: () => Observable<T>): Observable<T> {
    return new Observable<T>(sink => {
      if (this.queue.length >= this.maxQueued) {
        sink.complete();
        return;
      }

      const job: ReceiptJob = {
        start: () => {
          if (sink.closed) return;
          this.active++;
          let terminal = false;
          const inner = new Subscriber<T>({
            next: (value: T) => sink.next(value),
            error: (error: unknown) => {
              terminal = true;
              sink.error(error);
            },
            complete: () => {
              terminal = true;
              sink.complete();
            },
          });
          // Attach before subscribing, including synchronous completion/error.
          sink.add(inner);
          sink.add(() => {
            this.active--;
            if (terminal) this.drain();
            else this.drainAfterCancellation();
          });
          defer(work).subscribe(inner);
        },
      };

      sink.add(() => {
        const index = this.queue.indexOf(job);
        if (index >= 0) this.queue.splice(index, 1);
      });
      this.queue.push(job);
      this.drain();
    });
  }

  private drain(): void {
    if (this.draining || this.drainScheduled) return;
    this.draining = true;
    try {
      while (this.active < this.concurrency && this.queue.length && !this.drainScheduled) {
        this.queue.shift()!.start();
      }
    } finally {
      this.draining = false;
    }
  }

  private drainAfterCancellation(): void {
    // A batch/session teardown unsubscribes several sibling jobs in sequence.
    // Do not start queued siblings while that synchronous teardown is underway.
    if (this.drainScheduled) return;
    this.drainScheduled = true;
    queueMicrotask(() => {
      this.drainScheduled = false;
      this.drain();
    });
  }
}
