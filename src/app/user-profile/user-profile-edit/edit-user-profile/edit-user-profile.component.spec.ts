//src\app\user-profile\user-profile-edit\edit-user-profile\edit-user-profile.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EditUserProfileComponent } from './edit-user-profile.component';
import { beforeEach, describe, expect, it } from 'vitest';

describe('EditUserProfileComponent', () => {
  let component: EditUserProfileComponent;
  let fixture: ComponentFixture<EditUserProfileComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [EditUserProfileComponent]
    });
    fixture = TestBed.createComponent(EditUserProfileComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
