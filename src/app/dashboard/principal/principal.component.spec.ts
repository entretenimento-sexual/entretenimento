// src/app/dashboard/principal/principal.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { PrincipalComponent } from './principal.component';

import { selectPendingFriendRequestsCount } from '../../store/selectors/selectors.interactions/friend.selector';
import { selectCurrentUser } from '../../store/selectors/selectors.user/user.selectors';
import { IUserDados } from '../../core/interfaces/iuser-dados';


describe('PrincipalComponent', () => {
  let component: PrincipalComponent;
  let fixture: ComponentFixture<PrincipalComponent>;
  let store: MockStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PrincipalComponent],
      providers: [
        provideMockStore({
          initialState: {
            user: { currentUser: null },
            friendship: { requests: [], friends: [], incoming: [], sent: [], loading: false, error: null },
          },
        }),
      ],
    }).compileComponents();

    store = TestBed.inject(MockStore);

    // 👇 Garante emissões pros selects que o componente usa
    store.overrideSelector(selectCurrentUser, {
      uid: 'u1',
      email: 'x@y.com',
      profileCompleted: true,
    } as unknown as IUserDados);
    store.overrideSelector(selectPendingFriendRequestsCount, 0);

    fixture = TestBed.createComponent(PrincipalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
