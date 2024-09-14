import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UserPhotoManagerComponent } from './user-photo-manager.component';

describe('UserPhotoManagerComponent', () => {
  let component: UserPhotoManagerComponent;
  let fixture: ComponentFixture<UserPhotoManagerComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UserPhotoManagerComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(UserPhotoManagerComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
