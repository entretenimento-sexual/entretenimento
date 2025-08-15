//src\app\user-profile\user-profile-view\user-profile-view.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UserProfileViewComponent } from './user-profile-view.component';
import { provideMockStore } from '@ngrx/store/testing';
import { of, BehaviorSubject } from 'rxjs';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { AuthService } from '../../core/services/autentication/auth.service';
import { SidebarService } from '../../core/services/sidebar.service';
import { UserSocialLinksService } from '../../core/services/user-profile/user-social-links.service';

describe('UserProfileViewComponent', () => {
  let fixture: ComponentFixture<UserProfileViewComponent>;

  const initialState = {
    users: { users: { 'test-uid': { uid: 'test-uid', isSidebarOpen: false } } },
    friends: { friends: [], requests: [] },
  } as any;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UserProfileViewComponent],
      providers: [
        provideMockStore({ initialState }),
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'test-uid' })) } },
        { provide: AuthService, useValue: { user$: of({ uid: 'test-uid' }), getLoggedUserUID$: () => of('test-uid') } },
        { provide: SidebarService, useValue: { isSidebarVisible$: new BehaviorSubject(false) } },
        // evita chamar Firestore dentro do accordion
        { provide: UserSocialLinksService, useValue: { getSocialLinks: () => of(null) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UserProfileViewComponent);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });
});
