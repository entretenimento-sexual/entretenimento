//src\app\layout\friend.management\friend-requests\friend-requests.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { FriendRequestsComponent } from './friend-requests.component';

describe('FriendRequestsComponent', () => {
  let fixture: ComponentFixture<FriendRequestsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FriendRequestsComponent],
      providers: [
        provideMockStore({ initialState: { friends: { requests: [] } } }),
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FriendRequestsComponent);
    fixture.componentRef.setInput('user', { uid: 'u1' } as any);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });
});
