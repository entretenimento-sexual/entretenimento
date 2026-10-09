import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Router } from '@angular/router';
import { BehaviorSubject, Subject } from 'rxjs';
import { vi } from 'vitest';

import { AccessControlService } from '@core/services/autentication/auth/access-control.service';
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import * as A from '../../../actions/actions.interactions/actions.friends';
import { FriendsRequestsProfilesEffects } from './requests-profiles.effects';

describe('FriendsRequestsProfilesEffects / isolamento assíncrono', () => {
  it.each([
    ['loadRequesterProfiles$', A.loadRequesterProfiles({ uids: ['requester'] })],
    ['loadTargetProfiles$', A.loadTargetProfiles({ uids: ['target'] })],
  ] as const)('ignora retorno tardio de %s quando muda UID', (effectName, action) => {
    const actions = new Subject<typeof action>();
    const uid = new BehaviorSubject<string | null>('user-a');
    const response = new Subject<Record<string, never>>();
    const getUsersPublicMap$ = vi.fn(() => response.asObservable());

    TestBed.configureTestingModule({
      providers: [
        FriendsRequestsProfilesEffects,
        { provide: Actions, useValue: new Actions(actions) },
        { provide: AccessControlService, useValue: { authUid$: uid.asObservable() } },
        { provide: FirestoreUserQueryService, useValue: { getUsersPublicMap$ } },
        { provide: Store, useValue: { select: vi.fn() } },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
        { provide: Router, useValue: { navigate: vi.fn() } },
      ],
    });

    const effects = TestBed.inject(FriendsRequestsProfilesEffects);
    const output: unknown[] = [];
    const subscription = effects[effectName].subscribe(value => output.push(value));

    actions.next(action);
    expect(getUsersPublicMap$).toHaveBeenCalledTimes(1);
    uid.next('user-b');
    response.next({});
    expect(output).toEqual([]);
    subscription.unsubscribe();
  });
});
