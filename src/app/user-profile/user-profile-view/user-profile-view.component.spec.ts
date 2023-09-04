import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UserProfileViewComponent } from './user-profile-view.component';

describe('UserProfileViewComponent', () => {
  let component: UserProfileViewComponent;
  let fixture: ComponentFixture<UserProfileViewComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [UserProfileViewComponent]
    });
    fixture = TestBed.createComponent(UserProfileViewComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
