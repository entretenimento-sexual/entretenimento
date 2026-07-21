import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CurrentUserStoreService } from '@core/services/autentication/auth/current-user-store.service';
import { IUserDados } from '@core/interfaces/iuser-dados';
import { AccountLifecycleFacade } from './account-lifecycle.facade';

describe('AccountLifecycleFacade', () => {
  let user$: BehaviorSubject<IUserDados | null | undefined>;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'));

    user$ = new BehaviorSubject<IUserDados | null | undefined>(undefined);

    TestBed.configureTestingModule({
      providers: [
        AccountLifecycleFacade,
        {
          provide: CurrentUserStoreService,
          useValue: { user$: user$.asObservable() },
        },
      ],
    });
  });

  afterEach(() => {
    user$.complete();
    vi.useRealTimers();
  });

  async function readStatusVm() {
    const facade = TestBed.inject(AccountLifecycleFacade);
    const resultPromise = firstValueFrom(facade.statusVm$.pipe(take(1)));

    await vi.advanceTimersByTimeAsync(0);

    return resultPromise;
  }

  it('permite cancelar exclusão própria somente dentro do prazo', async () => {
    user$.next({
      uid: 'user-1',
      accountStatus: 'pending_deletion',
      deletionRequestedBy: 'self',
      deletionUndoUntil: Date.now() + 60_000,
      purgeAfter: Date.now() + 60_000,
    } as IUserDados);

    const vm = await readStatusVm();

    expect(vm.canCancelDeletion).toBe(true);
    expect(vm.badgeLabel).toBe('Exclusão pendente');
  });

  it('oculta cancelamento quando o prazo terminou', async () => {
    user$.next({
      uid: 'user-1',
      accountStatus: 'pending_deletion',
      deletionRequestedBy: 'self',
      deletionUndoUntil: Date.now() - 1,
      purgeAfter: Date.now() - 1,
    } as IUserDados);

    const vm = await readStatusVm();

    expect(vm.canCancelDeletion).toBe(false);
    expect(vm.badgeLabel).toBe('Cancelamento encerrado');
  });

  it('não permite cancelar exclusão aplicada por outro fluxo', async () => {
    user$.next({
      uid: 'user-1',
      accountStatus: 'pending_deletion',
      deletionRequestedBy: 'moderator',
      deletionUndoUntil: Date.now() + 60_000,
      purgeAfter: Date.now() + 60_000,
    } as IUserDados);

    const vm = await readStatusVm();

    expect(vm.canCancelDeletion).toBe(false);
  });

  it('não oferece reativação própria para suspensão da moderação', async () => {
    user$.next({
      uid: 'user-1',
      accountStatus: 'moderation_suspended',
      suspended: true,
      suspensionSource: 'moderator',
    } as IUserDados);

    const vm = await readStatusVm();

    expect(vm.canReactivateSelfSuspension).toBe(false);
    expect(vm.isBlocked).toBe(true);
  });
});
