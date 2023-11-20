import { ComponentFixture, TestBed } from '@angular/core/testing';

import { EditProfileSocialLinksComponent } from './edit-profile-social-links.component';

describe('EditProfileSocialLinksComponent', () => {
  let component: EditProfileSocialLinksComponent;
  let fixture: ComponentFixture<EditProfileSocialLinksComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [EditProfileSocialLinksComponent]
    });
    fixture = TestBed.createComponent(EditProfileSocialLinksComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
