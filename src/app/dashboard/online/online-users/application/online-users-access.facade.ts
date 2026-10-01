import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { Observable, combineLatest, firstValueFrom } from 'rxjs';
import {
  distinctUntilChanged,
  filter,
  map,
  shareReplay,
  startWith,
  take,
} from 'rxjs/operators';

import { AccessControlService } from 'src/app/core/services/autentication/auth/access-control.service';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import {
  selectCurrentUser,
  selectCurrentUserStatus,
} from 'src/app/store/selectors/selectors.user/user.selectors';
import { AppState } from 'src/app/store/states/app.state';

export interface OnlineUsersAccessGate {
  canStart: boolean;
  uid: string | null;
  user: IUserDados | null;
}

export type OnlineUsersLocationAccessDecision =
  | { kind: 'allowed'; user: IUserDados }
  | { kind: 'signed_out' }
  | { kind: 'profile_incomplete' }
  | { kind: 'unavailable' };

function shallowUserEqual(
  a: IUserDados | null,
  b: IUserDados | null
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;

  return (
    a.uid === b.uid &&
    a.emailVerified === b.emailVerified &&
    a.role === b.role &&
    a.profileCompleted === b.profileCompleted &&
    (a.municipio || '') === (b.municipio || '') &&
    (a.estado || '') === (b.estado || '')
  );
}

@Injectable()
export class OnlineUsersAccessFacade {
  private readonly store = inject<Store<AppState>>(Store as any);
  private readonly access = inject(AccessControlService);
  private readonly router = inject(Router);

  readonly currentUserStatus$ =
    this.store.select(selectCurrentUserStatus);

  readonly currentUserResolved$ =
    this.store.select(selectCurrentUser).pipe(
      startWith(undefined as IUserDados | null | undefined),
      filter(
        (user): user is IUserDados | null =>
          user !== undefined
      ),
      distinctUntilChanged((a, b) => shallowUserEqual(a, b)),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  private readonly authUid$ = this.access.authUid$.pipe(
    map((uid) => String(uid ?? '').trim() || null),
    distinctUntilChanged(),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  private readonly canRunOnlineUsers$ =
    this.access.canRunOnlineUsers$.pipe(
      distinctUntilChanged(),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly gate$: Observable<OnlineUsersAccessGate> =
    combineLatest([
      this.canRunOnlineUsers$,
      this.authUid$,
      this.currentUserResolved$,
    ]).pipe(
      map(([canRunFeature, uid, user]) => {
        const hasOperationalUser = !!user?.uid;

        return {
          canStart:
            canRunFeature === true &&
            !!uid &&
            hasOperationalUser,
          uid,
          user: hasOperationalUser ? user : null,
        };
      }),
      distinctUntilChanged(
        (a, b) =>
          a.canStart === b.canStart &&
          a.uid === b.uid &&
          shallowUserEqual(a.user, b.user)
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  checkLocationAccess$():
    Observable<OnlineUsersLocationAccessDecision> {
    return combineLatest([
      this.access.canRunOnlineUsers$,
      this.access.profileEligible$,
      this.currentUserResolved$,
    ]).pipe(
      take(1),
      map(([canRun, profileEligible, currentUser]) => {
        if (!currentUser?.uid) {
          return {
            kind: 'signed_out',
          } satisfies OnlineUsersLocationAccessDecision;
        }

        if (!profileEligible) {
          return {
            kind: 'profile_incomplete',
          } satisfies OnlineUsersLocationAccessDecision;
        }

        if (!canRun) {
          return {
            kind: 'unavailable',
          } satisfies OnlineUsersLocationAccessDecision;
        }

        return {
          kind: 'allowed',
          user: currentUser,
        } satisfies OnlineUsersLocationAccessDecision;
      })
    );
  }

  async goToFinishMinimumProfile(): Promise<void> {
    const redirectTo = this.normalizeRedirectTarget(
      this.router.url
    );

    const currentUser = await firstValueFrom(
      this.currentUserResolved$.pipe(take(1))
    ).catch(() => null);

    if (currentUser?.emailVerified !== true) {
      await this.router
        .navigate(['/register/welcome'], {
          queryParams: {
            autocheck: '1',
            reason: 'email_unverified',
            redirectTo,
          },
        })
        .catch(() => undefined);
      return;
    }

    await this.router
      .navigate(['/register/finalizar-cadastro'], {
        queryParams: {
          reason: 'profile_incomplete',
          redirectTo,
        },
      })
      .catch(() => undefined);
  }

  private normalizeRedirectTarget(
    url: string | null | undefined
  ): string {
    const clean = String(url ?? '').trim();

    if (
      !clean ||
      !clean.startsWith('/') ||
      clean.startsWith('//')
    ) {
      return '/dashboard/explorar';
    }

    return clean;
  }
}
