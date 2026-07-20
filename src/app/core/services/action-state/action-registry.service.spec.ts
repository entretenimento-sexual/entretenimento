import { TestBed } from '@angular/core/testing';
import { Subject, firstValueFrom, of } from 'rxjs';
import { take, toArray } from 'rxjs/operators';
import { beforeEach, describe, expect, it } from 'vitest';

import { ActionRegistryService } from './action-registry.service';

describe('ActionRegistryService', () => {
  let service: ActionRegistryService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(ActionRegistryService);
  });

  it('publica pendência durante a operação e libera ao concluir', async () => {
    const source = new Subject<string>();
    const statesPromise = firstValueFrom(
      service.isPending$('room-close:r1').pipe(take(3), toArray())
    );

    const subscription = service
      .track$('room-close:r1', () => source.asObservable())
      .subscribe();

    expect(service.isPendingSnapshot('room-close:r1')).toBe(true);

    source.next('ok');
    source.complete();

    expect(service.isPendingSnapshot('room-close:r1')).toBe(false);
    expect(await statesPromise).toEqual([false, true, false]);
    subscription.unsubscribe();
  });

  it('mantém a chave pendente enquanto houver operações concorrentes', () => {
    const first = new Subject<void>();
    const second = new Subject<void>();

    service.track$('same-key', () => first).subscribe();
    service.track$('same-key', () => second).subscribe();

    first.complete();
    expect(service.isPendingSnapshot('same-key')).toBe(true);

    second.complete();
    expect(service.isPendingSnapshot('same-key')).toBe(false);
  });

  it('libera a chave quando a assinatura é cancelada', () => {
    const subscription = service
      .track$('cancelable', () => new Subject<void>())
      .subscribe();

    expect(service.isPendingSnapshot('cancelable')).toBe(true);
    subscription.unsubscribe();
    expect(service.isPendingSnapshot('cancelable')).toBe(false);
  });

  it('recusa chave vazia', () => {
    expect(() => service.track$(' ', () => of(true)).subscribe()).toThrow(
      'Chave de ação inválida.'
    );
  });
});
