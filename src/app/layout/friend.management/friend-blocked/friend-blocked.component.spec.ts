//src\app\layout\friend.management\friend-blocked\friend-blocked.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FriendBlockedComponent } from './friend-blocked.component';

describe('FriendBlockedComponent', () => {
  let component: FriendBlockedComponent;
  let fixture: ComponentFixture<FriendBlockedComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FriendBlockedComponent]
    }).compileComponents();

    fixture = TestBed.createComponent(FriendBlockedComponent);
    // 👇 resolve NG0950
    fixture.componentRef.setInput('user', { uid: 'u1', nickname: 'Tester' } as any);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
