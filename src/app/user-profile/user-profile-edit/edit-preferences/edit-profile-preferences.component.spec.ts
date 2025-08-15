// src/app/user-profile/user-profile-edit/edit-preferences/edit-profile-preferences.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { EditProfilePreferencesComponent } from './edit-profile-preferences.component';

describe('EditProfilePreferencesComponent', () => {
  let fixture: ComponentFixture<EditProfilePreferencesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      declarations: [EditProfilePreferencesComponent], // não-standalone?
      imports: [FormsModule, ReactiveFormsModule],      // 👈 precisa p/ ngForm
    }).compileComponents();

    fixture = TestBed.createComponent(EditProfilePreferencesComponent);
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });
});
