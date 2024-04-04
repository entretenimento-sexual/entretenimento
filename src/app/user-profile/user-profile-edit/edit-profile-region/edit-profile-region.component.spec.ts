import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EditProfileRegionComponent } from './edit-profile-region.component';

describe('EditProfileRegionComponent', () => {
  let component: EditProfileRegionComponent;
  let fixture: ComponentFixture<EditProfileRegionComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [EditProfileRegionComponent]
    });
    fixture = TestBed.createComponent(EditProfileRegionComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
