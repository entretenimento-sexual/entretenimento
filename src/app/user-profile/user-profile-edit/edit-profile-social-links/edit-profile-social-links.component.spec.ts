import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { of } from 'rxjs';
import { vi } from 'vitest';

import { EditProfileSocialLinksComponent } from './edit-profile-social-links.component';
import { UserSocialLinksService } from '../../../core/services/user-profile/user-social-links.service';

describe('EditProfileSocialLinksComponent', () => {
  let component: EditProfileSocialLinksComponent;
  let fixture: ComponentFixture<EditProfileSocialLinksComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({
      declarations: [EditProfileSocialLinksComponent],
      providers: [
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              paramMap: convertToParamMap({ uid: 'u1' }),
            },
          },
        },
        {
          provide: Router,
          useValue: {
            navigate: vi.fn(),
          },
        },
        {
          provide: UserSocialLinksService,
          useValue: {
            getSocialLinks: vi.fn(() => of({ instagram: 'tester' })),
            saveSocialLinks: vi.fn(() => of(void 0)),
            removeLink: vi.fn(() => of(void 0)),
          },
        },
      ],
    });
    fixture = TestBed.createComponent(EditProfileSocialLinksComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
