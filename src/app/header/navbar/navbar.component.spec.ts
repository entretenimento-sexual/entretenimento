// src/app/header/navbar/navbar.component.spec.ts
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { BreakpointObserver } from '@angular/cdk/layout';
import { BehaviorSubject, of } from 'rxjs';
import { By } from '@angular/platform-browser';

import { describe, beforeEach, it, expect, vi } from 'vitest';

import { NavbarComponent } from './navbar.component';
import { Auth } from '@angular/fire/auth';

import { AuthSessionService } from '../../core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from '../../core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';
import { SidebarService } from '../../core/services/navigation/sidebar.service';
import { AppNotificationService } from '../../core/services/notifications/app-notification.service';
import { LogoutService } from '../../core/services/autentication/auth/logout.service';

@Component({ standalone: true, template: '' })
class DummyRouteComponent {}

class MockSidebarService {
  vm$ = of({ isOpen: false });
  toggleSidebar = vi.fn();
}

class MockAuthSessionService {
  private readonly uidSubject = new BehaviorSubject<string | null>(null);
  private readonly readySubject = new BehaviorSubject<boolean>(true);
  private readonly authenticatedSubject = new BehaviorSubject<boolean>(false);
  private readonly authUserSubject = new BehaviorSubject<any | null>(null);

  uid$ = this.uidSubject.asObservable();
  ready$ = this.readySubject.asObservable();
  isAuthenticated$ = this.authenticatedSubject.asObservable();
  authUser$ = this.authUserSubject.asObservable();

  currentAuthUser: { uid: string; displayName?: string; email?: string; photoURL?: string } | null = null;

  setUid(uid: string | null): void {
    this.currentAuthUser = uid ? { uid, email: 'user@example.com' } : null;
    this.uidSubject.next(uid);
    this.authUserSubject.next(this.currentAuthUser);
    this.authenticatedSubject.next(!!uid);
  }
}

class MockCurrentUserStoreService {
  user$ = new BehaviorSubject<any | null | undefined>(undefined);
}

class MockErrorNotificationService {
  showSuccess = vi.fn();
  showError = vi.fn();
}

class MockLogoutService {
  logout$ = vi.fn(() => of(void 0));
}

describe('NavbarComponent', () => {
  let component: NavbarComponent;
  let fixture: ComponentFixture<NavbarComponent>;
  let router: Router;

  let session: MockAuthSessionService;
  let currentUserStore: MockCurrentUserStoreService;
  let sidebar: MockSidebarService;
  let notify: MockErrorNotificationService;
  let logout: MockLogoutService;

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
      imports: [
        DummyRouteComponent,
        RouterTestingModule.withRoutes([
          { path: 'login', component: DummyRouteComponent },
        ]),
      ],
      providers: [
        { provide: Auth, useValue: mockAuth },
        { provide: SidebarService, useClass: MockSidebarService },
        { provide: AuthSessionService, useClass: MockAuthSessionService },
        { provide: CurrentUserStoreService, useClass: MockCurrentUserStoreService },
        { provide: ErrorNotificationService, useClass: MockErrorNotificationService },
        { provide: LogoutService, useClass: MockLogoutService },
        {
          provide: AppNotificationService,
          useValue: {
            currentUserUnreadCount$: of(0),
          },
        },
        {
          provide: BreakpointObserver,
          useValue: {
            observe: vi.fn(() => of({ matches: false })),
          },
        },
      ],
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    router = TestBed.inject(Router);
    session = TestBed.inject(AuthSessionService) as unknown as MockAuthSessionService;
    currentUserStore = TestBed.inject(
      CurrentUserStoreService
    ) as unknown as MockCurrentUserStoreService;
    sidebar = TestBed.inject(SidebarService) as unknown as MockSidebarService;
    notify = TestBed.inject(ErrorNotificationService) as unknown as MockErrorNotificationService;
    logout = TestBed.inject(LogoutService) as unknown as MockLogoutService;

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

  it('deve marcar isLoginPage=true após navegar para /login', async () => {
    await router.navigateByUrl('/login');
    fixture.detectChanges();

    expect(component.isLoginPage).toBe(true);
  });

  it('logout: deve chamar logoutService e notificar sucesso', () => {
    component.logout();
    fixture.detectChanges();

    expect(logout.logout$).toHaveBeenCalled();
    expect(notify.showSuccess).toHaveBeenCalledWith('Você saiu da sua conta.');
  });

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

  it('deve suportar uid autenticado vindo do AuthSessionService', () => {
    session.setUid('uid-123');
    fixture.detectChanges();

    expect(session.currentAuthUser?.uid).toBe('uid-123');
  });

  it('consolida ações autenticadas no menu compacto da conta', () => {
    currentUserStore.user$.next({
      uid: 'uid-123',
      nickname: 'Alex',
      photoURL: null,
      role: 'free',
    });
    session.setUid('uid-123');
    fixture.detectChanges();

    const desktopMenu = fixture.debugElement.query(By.css('.navbar-menu'))
      .nativeElement as HTMLElement;
    const accountMenu = fixture.debugElement.query(By.css('.account-menu'))
      .nativeElement as HTMLElement;

    expect(accountMenu.textContent).toContain('Meu perfil');
    expect(accountMenu.textContent).toContain('Planos');
    expect(accountMenu.textContent).toContain('Sair');
    expect(desktopMenu.textContent).not.toContain('Principal');
    expect(fixture.debugElement.queryAll(By.css('.appearance-toggle'))).toHaveLength(2);
  });
});
