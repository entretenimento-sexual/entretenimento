import { ComponentFixture, TestBed } from '@angular/core/testing';

import { FriendActionsComponent } from './friend-actions.component';

describe('FriendActionsComponent', () => {
  let component: FriendActionsComponent;
  let fixture: ComponentFixture<FriendActionsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FriendActionsComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(FriendActionsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
