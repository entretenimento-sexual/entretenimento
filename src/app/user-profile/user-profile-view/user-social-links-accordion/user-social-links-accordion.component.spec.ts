import { ComponentFixture, TestBed } from '@angular/core/testing';

import { UserSocialLinksAccordionComponent } from './user-social-links-accordion.component';

describe('UserSocialLinksAccordionComponent', () => {
  let component: UserSocialLinksAccordionComponent;
  let fixture: ComponentFixture<UserSocialLinksAccordionComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UserSocialLinksAccordionComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(UserSocialLinksAccordionComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
