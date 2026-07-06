// src/app/dashboard/principal/principal.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { Auth } from '@angular/fire/auth';
import { Firestore } from '@angular/fire/firestore';

import { PrincipalComponent } from './principal.component';
import { selectCurrentUser } from '../../store/selectors/selectors.user/user.selectors';
import { IUserDados } from '../../core/interfaces/iuser-dados';

describe('PrincipalComponent', () => {
  let component: PrincipalComponent;
  let fixture: ComponentFixture<PrincipalComponent>;
  let store: MockStore;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        RouterTestingModule,
        PrincipalComponent,
      ],
      providers: [
        { provide: Auth, useValue: { currentUser: null } },
        { provide: Firestore, useValue: {} },
        provideMockStore({
          initialState: {
            user: { currentUser: null },
            friendship: { requests: [], friends: [], incoming: [], sent: [], loading: false, error: null },
          },
        }),
      ],
    }).compileComponents();

    store = TestBed.inject(MockStore);

    store.overrideSelector(selectCurrentUser, {
      uid: 'u1',
      email: 'x@y.com',
      profileCompleted: true,
    } as unknown as IUserDados);

    fixture = TestBed.createComponent(PrincipalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
