// src/app/header/navbar/navbar.component.spec.ts
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { Router, NavigationEnd } from '@angular/router';
import { RouterTestingModule } from '@angular/router/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { of, BehaviorSubject, Subject } from 'rxjs';

import { NavbarComponent } from './navbar.component';
import { Auth } from '@angular/fire/auth';

import { SidebarService } from '../../core/services/sidebar.service';
import { AuthSessionService } from '../../core/services/autentication/auth/auth-session.service';
import { CurrentUserStoreService } from '../../core/services/autentication/auth/current-user-store.service';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';

class MockSidebarService {
  toggleSidebar = jest.fn();
}

class MockAuthSessionService {
  signOut$ = jest.fn(() => of(void 0));
}

class MockCurrentUserStoreService {
  // o componente consome user$ (pode emitir `undefined` inicialmente)
  user$ = new BehaviorSubject<any | null | undefined>(undefined);
}

class MockErrorNotificationService {
  showSuccess = jest.fn();
  showError = jest.fn();
}

describe('NavbarComponent', () => {
  let component: NavbarComponent;
  let fixture: ComponentFixture<NavbarComponent>;
  let router: Router;

  // Auth do AngularFire (apenas currentUser usado no startWith)
  const mockAuth: Partial<Auth> = { currentUser: null } as any;

  beforeEach(async () => {
    // limpamos efeitos de tema persistidos entre testes
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
      // evita erros com <app-logo>, <app-links-interaction>, etc.
      schemas: [NO_ERRORS_SCHEMA],
    }).compileComponents();

    router = TestBed.inject(Router);
    fixture = TestBed.createComponent(NavbarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('deve criar o componente', () => {
    expect(component).toBeTruthy();
  });

  it('deve alternar o sidebar ao chamar onToggleSidebar()', () => {
    const sidebar = TestBed.inject(SidebarService) as unknown as MockSidebarService;
    component.onToggleSidebar();
    expect(sidebar.toggleSidebar).toHaveBeenCalled();
  });

  it('deve marcar isLoginPage=true após navegar para /login', fakeAsync(async () => {
    await TestBed.inject(Router).navigateByUrl('/'); // inicial
    fixture.detectChanges();

    await router.navigateByUrl('/login');
    tick(); // processa NavigationEnd
    fixture.detectChanges();

    expect(component.isLoginPage).toBeTrue();
  }));

  it('logout: deve chamar signOut$, notificar sucesso e navegar para /login', fakeAsync(() => {
    const session = TestBed.inject(AuthSessionService) as unknown as MockAuthSessionService;
    const notify = TestBed.inject(ErrorNotificationService) as unknown as MockErrorNotificationService;

    // espiamos a navegação para garantir replaceUrl:true
    const navSpy = jest.spyOn(router, 'navigate').mockResolvedValue(true as any);

    component.logout(); // signOut$ -> next -> notify.showSuccess -> navigate('/login')
    tick();
    fixture.detectChanges();

    expect(session.signOut$).toHaveBeenCalled();
    expect(notify.showSuccess).toHaveBeenCalledWith('Você saiu da sua conta.');
    expect(navSpy).toHaveBeenCalledWith(['/login'], { replaceUrl: true });
  }));

  it('toggleDarkMode / toggleHighContrast / resetAppearance devem refletir no <html>', () => {
    // dark
    component.toggleDarkMode();
    expect(document.documentElement.classList.contains('dark-mode')).toBeTrue();
    expect(localStorage.getItem('theme')).toBe('dark');

    // high-contrast
    component.toggleHighContrast();
    expect(document.documentElement.classList.contains('high-contrast')).toBeTrue();
    expect(localStorage.getItem('high-contrast')).toBe('1');

    // reset
    component.resetAppearance();
    expect(document.documentElement.classList.contains('dark-mode')).toBeFalse();
    expect(document.documentElement.classList.contains('high-contrast')).toBeFalse();
    expect(localStorage.getItem('theme')).toBe('light');
    expect(localStorage.getItem('high-contrast')).toBe('0');
  });
});
