import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { vi } from 'vitest';

import { FriendBlockedComponent } from './friend-blocked.component';
import { FriendshipService } from 'src/app/core/services/interactions/friendship/friendship.service';
import { AuthSessionService } from 'src/app/core/services/autentication/auth/auth-session.service';
import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

describe('FriendBlockedComponent', () => {
  let fixture: ComponentFixture<FriendBlockedComponent>;
  let component: FriendBlockedComponent;
  let authUid$: BehaviorSubject<string | null>;
  let blocksA$: BehaviorSubject<readonly string[]>;
  let blocksB$: BehaviorSubject<readonly string[]>;
  let friendship: {
    watchBlockedUids: ReturnType<typeof vi.fn>;
    unblockUser: ReturnType<typeof vi.fn>;
  };
  let confirm: ReturnType<typeof vi.fn>;
  let notifier: { showSuccess: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    authUid$ = new BehaviorSubject<string | null>('viewer-a');
    blocksA$ = new BehaviorSubject<readonly string[]>(['target-a']);
    blocksB$ = new BehaviorSubject<readonly string[]>(['target-b']);
    friendship = {
      watchBlockedUids: vi.fn((uid: string) =>
        uid === 'viewer-a' ? blocksA$.asObservable() : blocksB$.asObservable()
      ),
      unblockUser: vi.fn(() => of(void 0)),
    };
    confirm = vi.fn(() => ({ afterClosed: () => of(true) }));
    notifier = { showSuccess: vi.fn() };

    await TestBed.configureTestingModule({
      imports: [FriendBlockedComponent],
      providers: [
        { provide: AuthSessionService, useValue: { uid$: authUid$.asObservable() } },
        { provide: FriendshipService, useValue: friendship },
        { provide: MatDialog, useValue: { open: confirm } },
        { provide: ApplicationErrorService, useValue: { report: vi.fn() } },
        { provide: ErrorNotificationService, useValue: notifier },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FriendBlockedComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('atualiza a lista sem recarregar e não mistura UIDs de contas distintas', () => {
    expect(fixture.nativeElement.textContent).toContain('Identificador final: target-a');
    blocksA$.next(['target-a', 'target-aa']);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('2 perfis bloqueados');

    authUid$.next('viewer-b');
    fixture.detectChanges();
    expect(friendship.watchBlockedUids).toHaveBeenCalledWith('viewer-b');
    expect(fixture.nativeElement.textContent).toContain('target-b');
    expect(fixture.nativeElement.textContent).not.toContain('target-a');

    authUid$.next(null);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Sessão encerrada');
    expect(fixture.nativeElement.textContent).not.toContain('target-b');
  });

  it('desbloqueia apenas a partir da identidade autenticada atual', () => {
    component.unblockUser('target-a');
    expect(friendship.unblockUser).toHaveBeenCalledWith('viewer-a','target-a');
    expect(notifier.showSuccess).toHaveBeenCalled();

    authUid$.next('viewer-b');
    fixture.detectChanges();
    component.unblockUser('target-b');
    expect(friendship.unblockUser).toHaveBeenCalledWith('viewer-b','target-b');
  });

  it('cancela feedback pendente se a sessão mudar durante o desbloqueio', () => {
    const inFlight = new Subject<void>();
    friendship.unblockUser.mockReturnValue(inFlight.asObservable());
    component.unblockUser('target-a');
    expect(component.pendingUid()).toBe('target-a');

    authUid$.next('viewer-b');
    inFlight.next();
    fixture.detectChanges();

    expect(component.pendingUid()).toBeNull();
    expect(notifier.showSuccess).not.toHaveBeenCalled();
  });
});
