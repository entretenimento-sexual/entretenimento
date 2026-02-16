// src/app/register-module/auth-verification-handler/auth-verification-handler.component.spec.ts
import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { Router } from '@angular/router';
import { NgZone } from '@angular/core';

import { AuthVerificationHandlerComponent } from './auth-verification-handler.component';

import { CurrentUserStoreService } from '../../core/services/autentication/auth/current-user-store.service';
import { FirestoreUserQueryService } from '../../core/services/data-handling/firestore-user-query.service';
import { FirestoreUserWriteService } from '../../core/services/data-handling/firestore-user-write.service';
import { DateTimeService } from '../../core/services/general/date-time.service';

import { IUserDados } from '../../core/interfaces/iuser-dados';
import { IUserRegistrationData } from '../../core/interfaces/iuser-registration-data';

describe('AuthVerificationHandlerComponent - finishRegistration', () => {
  let component: AuthVerificationHandlerComponent;

  const mockRouter = {
    navigate: jest.fn().mockResolvedValue(true),
  };

  const mockCurrentUserStore = {
    getLoggedUserUID$: jest.fn(),
  };

  const mockFirestoreUserQuery = {
    getUser: jest.fn(),
    updateUserInStateAndCache: jest.fn(),
  };

  // ✅ mock correto do novo service
  const mockFirestoreUserWrite = {
    saveInitialUserData$: jest.fn(),
  };

  const mockDateTimeService = {
    convertToDate: jest.fn(),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AuthVerificationHandlerComponent],
      providers: [
        { provide: Router, useValue: mockRouter },
        { provide: NgZone, useValue: new NgZone({ enableLongStackTrace: false }) },
        { provide: CurrentUserStoreService, useValue: mockCurrentUserStore },
        { provide: FirestoreUserQueryService, useValue: mockFirestoreUserQuery },
        { provide: FirestoreUserWriteService, useValue: mockFirestoreUserWrite },
        { provide: DateTimeService, useValue: mockDateTimeService },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(AuthVerificationHandlerComponent);
    component = fixture.componentInstance;

    component.gender = 'masculino';
    component.orientation = 'heterossexual';
    component.selectedEstado = 'SP';
    component.selectedMunicipio = 'São Paulo';

    jest.clearAllMocks();
  });

  it('normaliza firstLogin quando vier como number e envia Date para saveInitialUserData$', (done) => {
    const uid = 'user-123';
    const firstLoginMs = 1710000000000;

    const existingUserData: Partial<IUserDados> = {
      uid,
      email: 'x@y.com',
      nickname: 'x',
      isSubscriber: false,
      firstLogin: firstLoginMs as any,
    };

    mockCurrentUserStore.getLoggedUserUID$.mockReturnValue(of(uid));
    mockFirestoreUserQuery.getUser.mockReturnValue(of(existingUserData as IUserDados));

    const normalizedDate = new Date(firstLoginMs);
    mockDateTimeService.convertToDate.mockReturnValue(normalizedDate);

    mockFirestoreUserWrite.saveInitialUserData$.mockReturnValue(of(void 0));

    component.finishRegistration();

    setTimeout(() => {
      expect(mockDateTimeService.convertToDate).toHaveBeenCalledTimes(1);
      expect(mockDateTimeService.convertToDate).toHaveBeenCalledWith(firstLoginMs);

      expect(mockFirestoreUserWrite.saveInitialUserData$).toHaveBeenCalledTimes(1);

      const [calledUid, calledDto] =
        mockFirestoreUserWrite.saveInitialUserData$.mock.calls[0] as [string, IUserRegistrationData];

      expect(calledUid).toBe(uid);

      // ✅ cast para evitar erro TS2358 se firstLogin for tipado como number/union
      expect(((calledDto as any).firstLogin as any) instanceof Date).toBe(true);
      // opcional: garante que é exatamente o Date mockado
      expect((calledDto as any).firstLogin).toBe(normalizedDate);

      expect(mockFirestoreUserQuery.updateUserInStateAndCache).toHaveBeenCalledTimes(1);

      const [updateUid, updateDto] =
        mockFirestoreUserQuery.updateUserInStateAndCache.mock.calls[0] as [string, IUserRegistrationData];

      expect(updateUid).toBe(uid);
      expect(((updateDto as any).firstLogin as any) instanceof Date).toBe(true);
      expect((updateDto as any).firstLogin).toBe(normalizedDate);

      expect(mockRouter.navigate).toHaveBeenCalledWith(
        ['/register/welcome'],
        { queryParams: { autocheck: '1' }, replaceUrl: true }
      );

      expect(component.showSubscriptionOptions).toBe(true);
      done();
    }, 0);
  });
});
