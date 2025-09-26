// src/app/header/navbar/navbar.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { NO_ERRORS_SCHEMA } from '@angular/core';
import { of } from 'rxjs';

import { NavbarComponent } from './navbar.component';
import { Auth } from '@angular/fire/auth';
import { AuthService } from '../../core/services/autentication/auth.service';
import { SidebarService } from '../../core/services/sidebar.service';

describe('NavbarComponent', () => {
  let component: NavbarComponent;
  let fixture: ComponentFixture<NavbarComponent>;

  const mockAuth: Partial<Auth> = { currentUser: null } as any;

  const mockAuthService = {
    user$: of(null),
    logout: jest.fn(() => of(void 0)),
    getLoggedUserUID$: jest.fn(() => of(null)),
    isAuthenticated: jest.fn(() => false),
  };

  const mockSidebarService = {
    toggleSidebar: jest.fn(),
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [NavbarComponent],
      imports: [RouterTestingModule],
      providers: [
        { provide: Auth, useValue: mockAuth },
        { provide: AuthService, useValue: mockAuthService },
        { provide: SidebarService, useValue: mockSidebarService },
      ],
      schemas: [NO_ERRORS_SCHEMA], // evita erros de template por tags desconhecidas
    }).compileComponents();

    fixture = TestBed.createComponent(NavbarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
