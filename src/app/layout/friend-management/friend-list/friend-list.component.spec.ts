//src\app\layout\friend-management\friend-list\friend-list.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideMockStore } from '@ngrx/store/testing';
import { FriendListComponent } from './friend-list.component';

describe('FriendListComponent', () => {
  let fixture: ComponentFixture<FriendListComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FriendListComponent],
      providers: [
        provideMockStore({ initialState: { friends: { friends: [] } } }),
        { provide: 'UserInteractionsService', useValue: { blockUser: () => ({ subscribe: () => { } }) } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(FriendListComponent);
    fixture.componentRef.setInput('user', { uid: 'u1' } as any);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });
});
