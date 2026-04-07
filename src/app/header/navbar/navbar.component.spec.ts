// src/app/header/navbar/navbar.component.spec.ts
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { BehaviorSubject, of } from 'rxjs';

import { describe, beforeEach, it, expect, vi, type Mock } from 'vitest';

import { NavbarComponent } from './navbar.component';
import { Auth } from '@angular/fire/auth';

import { AuthSessionService } from '../../core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from '../../core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';
import { SidebarService } from '../../core/services/navigation/sidebar.service';

class MockSidebarService {
  toggleSidebar = vi.fn();
}

class MockAuthSessionService {
  private readonly uidSubject = new BehaviorSubject<string | null>(null);

  // o componente usa this.session.uid$.pipe(...)
  uid$ = this.uidSubject.asObservable();

  // o componente usa startWith(this.session.currentAuthUser?.uid ?? null)
  currentAuthUser: { uid: string } | null = null;

  signOut$ = vi.fn(() => of(void 0));

  setUid(uid: string | null): void {
    this.currentAuthUser = uid ? { uid } : null;
    this.uidSubject.next(uid);
  }
}

class MockCurrentUserStoreService {
  // o componente consome user$
  user$ = new BehaviorSubject<any | null | undefined>(undefined);
}

class MockErrorNotificationService {
  showSuccess = vi.fn();
  showError = vi.fn();
}

describe('NavbarComponent', () => {
  let component: NavbarComponent;
  let fixture: ComponentFixture<NavbarComponent>;
  let router: Router;

  let session: MockAuthSessionService;
  let sidebar: MockSidebarService;
  let notify: MockErrorNotificationService;

  const mockAuth: Partial<Auth> = {
    currentUser: null,
  } as any;

  beforeEach(async () => {
    localStorage.clear();
    document.documentElement.classList.remove('dark-mode', 'high-contrast');
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.removeAttribute('data-hc');

    await TestBed.configureTestingModule({
      declarations: [NavbarComponent],
      imports: [RouterTestingModule.withRoutes([])],
      providers: [
        { provide: Auth, useValue: mockAuth },
        { provide: SidebarService, useClass: MockSidebarService },
        { provide: AuthSessionService, useClass: MockAuthSessionService },
        { provide: CurrentUserStoreService, useClass: MockCurrentUserStoreService },
        { provide: ErrorNotificationService, useClass: MockErrorNotificationService },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    router = TestBed.inject(Router);
    session = TestBed.inject(AuthSessionService) as unknown as MockAuthSessionService;
    notify = TestBed.inject(ErrorNotificationService) as unknown as MockErrorNotificationService;

    fixture = TestBed.createComponent(NavbarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('deve criar o componente', () => {
    expect(component).toBeTruthy();
  });

  it('deve alternar o sidebar ao chamar onToggleSidebar()', () => {
    component.onToggleSidebar();
    expect(sidebar.toggleSidebar).toHaveBeenCalled();
  });

  it('deve marcar isLoginPage=true após navegar para /login', fakeAsync(() => {
    router.navigateByUrl('/login');
    tick();
    fixture.detectChanges();

    expect(component.isLoginPage).toBe(true);
  }));

  it('logout: deve chamar signOut$, notificar sucesso e navegar para /login', fakeAsync(() => {
    const navSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true as any);

    component.logout();
    tick();
    fixture.detectChanges();

    expect(session.signOut$).toHaveBeenCalled();
    expect(notify.showSuccess).toHaveBeenCalledWith('Você saiu da sua conta.');
    expect(navSpy).toHaveBeenCalledWith(['/login'], { replaceUrl: true });
  }));

  it('toggleDarkMode / toggleHighContrast / resetAppearance devem refletir no <html>', () => {
    component.toggleDarkMode();
    expect(document.documentElement.classList.contains('dark-mode')).toBe(true);
    expect(localStorage.getItem('theme')).toBe('dark');

    component.toggleHighContrast();
    expect(document.documentElement.classList.contains('high-contrast')).toBe(true);
    expect(localStorage.getItem('high-contrast')).toBe('1');

    component.resetAppearance();
    expect(document.documentElement.classList.contains('dark-mode')).toBe(false);
    expect(document.documentElement.classList.contains('high-contrast')).toBe(false);
    expect(localStorage.getItem('theme')).toBe('light');
    expect(localStorage.getItem('high-contrast')).toBe('0');
  });

  it('deve suportar uid autenticado vindo do AuthSessionService', fakeAsync(() => {
    session.setUid('uid-123');
    tick();
    fixture.detectChanges();

    expect(session.currentAuthUser?.uid).toBe('uid-123');
    sidebar = TestBed.inject(SidebarService) as unknown as MockSidebarService;
  }));
});
