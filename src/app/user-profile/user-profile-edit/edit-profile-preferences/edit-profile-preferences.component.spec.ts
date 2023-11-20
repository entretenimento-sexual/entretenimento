import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EditProfilePreferencesComponent } from './edit-profile-preferences.component';

describe('EditProfilePreferencesComponent', () => {
  let component: EditProfilePreferencesComponent;
  let fixture: ComponentFixture<EditProfilePreferencesComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [EditProfilePreferencesComponent]
    });
    fixture = TestBed.createComponent(EditProfilePreferencesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
