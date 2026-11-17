import { TestBed } from '@angular/core/testing';
import { BehaviorSubject, of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';

import { AccessControlService } from '@core/services/autentication/auth/access-control.service';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import { ApplicationErrorService } from '@core/services/error-handler/application-error.service';
import { ErrorNotificationService } from '@core/services/error-handler/error-notification.service';
import { PrivacyDebugLoggerService } from '../privacy/privacy-debug-logger.service';
import { PresenceOrchestratorService } from './presence-orchestrator.service';
import { PresenceService } from './presence.service';

describe('PresenceOrchestratorService durante logout', () => {
  it('delega a parada voluntária ao LogoutService e rearma presença se a sessão voltar', () => {
    const uid$ = new BehaviorSubject<string | null>('a');
    const isTerminating$ = new BehaviorSubject(false);
    const authSession = {
      isTerminating$,
      isTerminatingSnapshot: false,
    };
    const presence = { start: vi.fn(), stop$: vi.fn(() => of(void 0)) };
    TestBed.configureTestingModule({
      providers: [
        { provide: AuthSessionService, useValue: authSession },
        { provide: AccessControlService, useValue: { authUid$: uid$, canRunPresence$: of(true) } },
        { provide: PresenceService, useValue: presence },
        { provide: ApplicationErrorService, useValue: { report: vi.fn() } },
        { provide: ErrorNotificationService, useValue: { showError: vi.fn() } },
        { provide: PrivacyDebugLoggerService, useValue: { log: vi.fn() } },
      ],
    });
    TestBed.inject(PresenceOrchestratorService).start();
    expect(presence.start).toHaveBeenCalledOnce();

    authSession.isTerminatingSnapshot = true;
    uid$.next(null);
    isTerminating$.next(true);
    expect(presence.stop$).not.toHaveBeenCalled();

    authSession.isTerminatingSnapshot = false;
    uid$.next('a');
    isTerminating$.next(false);
    expect(presence.start).toHaveBeenCalledTimes(2);

    authSession.isTerminatingSnapshot = true;
    isTerminating$.next(true);
    uid$.next(null);
    authSession.isTerminatingSnapshot = false;
    isTerminating$.next(false);
    expect(presence.stop$).not.toHaveBeenCalled();

    uid$.next('b');
    uid$.next(null);
    expect(presence.stop$).toHaveBeenCalledOnce();
  });
});
