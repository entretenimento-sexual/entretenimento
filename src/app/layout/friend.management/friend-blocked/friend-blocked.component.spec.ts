import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FriendBlockedComponent } from './friend-blocked.component';

describe('FriendBlockedComponent', () => {
  let component: FriendBlockedComponent;
  let fixture: ComponentFixture<FriendBlockedComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FriendBlockedComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(FriendBlockedComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
