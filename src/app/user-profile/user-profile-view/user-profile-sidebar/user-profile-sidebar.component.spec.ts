// src/app/user-profile/user-profile-view/user-profile-sidebar/user-profile-sidebar.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { of } from 'rxjs';

import { UserProfileSidebarComponent } from './user-profile-sidebar.component';
import { AuthenticatedNavigationService } from '../../../core/services/navigation/authenticated-navigation.service';

const navigationVm = {
  ready: true,
  uid: 'u1',
  usuario: {
    uid: 'u1',
    nickname: 'Alex',
    photoURL: '',
    role: 'premium',
  },
  subscriptionRole: 'premium' as const,
  isSubscriber: true,
  currentUrl: '/perfil',
  viewedUid: 'u1',
  isProfileRoute: true,
  isOwnProfileRoute: true,
};

describe('UserProfileSidebarComponent', () => {
  let component: UserProfileSidebarComponent;
  let fixture: ComponentFixture<UserProfileSidebarComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        UserProfileSidebarComponent,
        RouterTestingModule.withRoutes([]),
      ],
      providers: [
        {
          provide: AuthenticatedNavigationService,
          useValue: {
            vm$: of(navigationVm),
            items$: of([
              {
                id: 'friends',
                label: 'Minhas conexões',
                routerLink: ['/friends', 'list'],
              },
              {
                id: 'chat',
                label: 'Mensagens',
                routerLink: ['/chat'],
              },
            ]),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UserProfileSidebarComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('não oferece criação de Sala e mantém os destinos canônicos do perfil', () => {
    const text = String(fixture.nativeElement.textContent ?? '');

    expect(text).toContain('Minhas conexões');
    expect(text).toContain('Mensagens');
    expect(text).not.toContain('Criar sala');
  });
});