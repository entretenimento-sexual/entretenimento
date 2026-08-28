import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UserPrivacySettingsComponent } from './user-privacy-settings.component';

describe('UserPrivacySettingsComponent', () => {
  let component: UserPrivacySettingsComponent;
  let fixture: ComponentFixture<UserPrivacySettingsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UserPrivacySettingsComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(UserPrivacySettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
