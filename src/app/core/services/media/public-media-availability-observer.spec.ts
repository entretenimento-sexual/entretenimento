import { Subject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import {
  combinePublicVideoExposure$, watchPublicMediaAvailability$,
} from './public-media-availability-observer';

describe('public media projection observer', () => {
  it('aguarda projeção legada na primeira leitura sem revogar playback', () => {
    const projection$ = new Subject<boolean | null>();
    const reconciliation$ = new Subject<false>();
    const reconcile = vi.fn(() => reconciliation$.asObservable());
    const received: boolean[] = [];
    const subscription = watchPublicMediaAvailability$(
      projection$, reconcile
    ).subscribe((allowed) => received.push(allowed));

    projection$.next(null);
    projection$.next(null);
    expect(received).toEqual([]);
    expect(reconcile).toHaveBeenCalledTimes(1);

    projection$.next(true);
    expect(received).toEqual([true]);

    // This response came from the cancelled, initial reconciliation flight.
    reconciliation$.next(false);
    expect(received).toEqual([true]);
    subscription.unsubscribe();
  });

  it('revoga imediatamente quando projeção permitida é excluída', () => {
    const projection$ = new Subject<boolean | null>();
    const reconciliation$ = new Subject<false>();
    const received: boolean[] = [];
    const reconcile = vi.fn(() => reconciliation$.asObservable());
    const subscription = watchPublicMediaAvailability$(
      projection$, reconcile
    ).subscribe((allowed) => received.push(allowed));

    projection$.next(true);
    projection$.next(null);
    expect(received).toEqual([true, false]);
    expect(reconcile).toHaveBeenCalledTimes(1);

    // A late reconciliation is not a grant; only a new document can allow.
    reconciliation$.next(false);
    expect(received).toEqual([true, false]);
    projection$.next(true);
    expect(received).toEqual([true, false, true]);
    subscription.unsubscribe();
  });

  it('nega explicitamente falha de reconciliação inicial', () => {
    const projection$ = new Subject<boolean | null>();
    const received: boolean[] = [];
    const subscription = watchPublicMediaAvailability$(
      projection$, () => of(false as const)
    ).subscribe((allowed) => received.push(allowed));

    projection$.next(null);
    expect(received).toEqual([false]);
    subscription.unsubscribe();
  });

  it('não reemite revogação depois de false nem refaz callable para null repetido', () => {
    const projection$ = new Subject<boolean | null>();
    const reconcile = vi.fn(() => new Subject<false>().asObservable());
    const received: boolean[] = [];
    const subscription = watchPublicMediaAvailability$(
      projection$, reconcile
    ).subscribe((allowed) => received.push(allowed));

    projection$.next(false);
    projection$.next(null);
    projection$.next(null);
    expect(received).toEqual([false]);
    expect(reconcile).toHaveBeenCalledTimes(1);
    subscription.unsubscribe();
  });

  it('isola o histórico de autorização por assinatura', () => {
    const projection$ = new Subject<boolean | null>();
    const receivedA: boolean[] = [];
    const receivedB: boolean[] = [];
    const reconciliation$ = new Subject<false>();
    const observe = () => watchPublicMediaAvailability$(
      projection$, () => reconciliation$.asObservable()
    );
    const subscriptionA = observe().subscribe((allowed) => receivedA.push(allowed));
    projection$.next(true);
    subscriptionA.unsubscribe();

    const subscriptionB = observe().subscribe((allowed) => receivedB.push(allowed));
    projection$.next(null);
    expect(receivedA).toEqual([true]);
    expect(receivedB).toEqual([]);
    subscriptionB.unsubscribe();
  });
});

describe('combined public video exposure', () => {
  it('revoga por negação pública mesmo com reconciliação bilateral pendente', () => {
    const published$ = new Subject<boolean>();
    const bilateral$ = new Subject<boolean>();
    const emitted: boolean[] = [];
    const subscription = combinePublicVideoExposure$(
      published$, bilateral$
    ).subscribe((allowed) => emitted.push(allowed));

    published$.next(false);
    expect(emitted).toEqual([false]);
    bilateral$.next(true);
    expect(emitted).toEqual([false]);
    published$.next(true);
    expect(emitted).toEqual([false, true]);
    subscription.unsubscribe();
  });

  it('revoga por bloqueio conhecido mesmo com projeção pública ainda pendente', () => {
    const published$ = new Subject<boolean>();
    const bilateral$ = new Subject<boolean>();
    const emitted: boolean[] = [];
    const subscription = combinePublicVideoExposure$(
      published$, bilateral$
    ).subscribe((allowed) => emitted.push(allowed));

    bilateral$.next(false);
    expect(emitted).toEqual([false]);
    published$.next(true);
    expect(emitted).toEqual([false]);
    subscription.unsubscribe();
  });

  it('não interpreta estados iniciais desconhecidos como restrição', () => {
    const published$ = new Subject<boolean>();
    const bilateral$ = new Subject<boolean>();
    const emitted: boolean[] = [];
    const subscription = combinePublicVideoExposure$(
      published$, bilateral$
    ).subscribe((allowed) => emitted.push(allowed));

    expect(emitted).toEqual([]);
    published$.next(true);
    expect(emitted).toEqual([]);
    bilateral$.next(true);
    expect(emitted).toEqual([true]);
    subscription.unsubscribe();
  });
});
