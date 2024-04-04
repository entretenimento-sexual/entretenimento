import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UserProfilePreferencesComponent } from './user-profile-preferences.component';

describe('UserProfilePreferencesComponent', () => {
  let component: UserProfilePreferencesComponent;
  let fixture: ComponentFixture<UserProfilePreferencesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UserProfilePreferencesComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(UserProfilePreferencesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
