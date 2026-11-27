// src/app/layout/friend-management/friend-list-page/friend-list-page.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideMockStore } from '@ngrx/store/testing';
import { BehaviorSubject } from 'rxjs';
import { AuthSessionService } from '@core/services/autentication/auth/auth-session.service';
import type { User } from 'firebase/auth';

import { FriendListPageComponent } from './friend-list-page.component';

import { IUserDados } from '../../../core/interfaces/iuser-dados';
import { selectCurrentUser } from '../../../store/selectors/selectors.user/user.selectors';
import {
  selectFriendsPageItems,
  selectFriendsPageLoading,
  selectFriendsPageReachedEnd,
  selectFriendsPageCount,
  selectFriendsPageOnlineCount,
} from '../../../store/selectors/selectors.interactions/friends/pagination.selectors';

describe('FriendListPageComponent', () => {
  let fixture: ComponentFixture<FriendListPageComponent>;
  let component: FriendListPageComponent;

  const user = { uid: 'u1', nickname: 'Alex' } as unknown as IUserDados;
  let authUser: BehaviorSubject<User | null>;

  beforeEach(async () => {
    authUser = new BehaviorSubject<User | null>(user as unknown as User);
    await TestBed.configureTestingModule({
      imports: [FriendListPageComponent, NoopAnimationsModule],
      providers: [
        { provide: AuthSessionService, useValue: { authUser$: authUser.asObservable() } },
        provideMockStore({
          selectors: [
            { selector: selectCurrentUser, value: user },
            { selector: selectFriendsPageItems(user.uid), value: [] },
            { selector: selectFriendsPageLoading(user.uid), value: false },
            { selector: selectFriendsPageReachedEnd(user.uid), value: false },
            { selector: selectFriendsPageCount(user.uid), value: 0 },
            { selector: selectFriendsPageOnlineCount(user.uid), value: 0 },
          ],
        }),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FriendListPageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });

  it('emite lista vazia no encerramento da sessão', () => {
    const output: unknown[] = [];
    const subscription = component.items$.subscribe(items => output.push(items));
    authUser.next(null);
    fixture.detectChanges();
    expect(output.at(-1)).toEqual([]);
    subscription.unsubscribe();
  });

  it('signals handlers should update ui state', () => {
    component.onSortChange('online');
    expect(component.sortBy()).toBe('online');

    component.onOnlyOnlineToggle(true);
    expect(component.filters().onlyOnline).toBe(true);

    component.onQueryChange('ana');
    expect(component.filters().q).toBe('ana');
  });
});
