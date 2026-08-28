import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';

import { SuggestedProfilesComponent } from './suggested-profiles.component';
import { CurrentUserStoreService } from '../../core/services/autentication/auth/current-user-store.service';
import { SuggestionService } from '../../core/services/user-profile/recommendations/suggestion.service';

describe('SuggestedProfilesComponent', () => {
  let component: SuggestedProfilesComponent;
  let fixture: ComponentFixture<SuggestedProfilesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SuggestedProfilesComponent],
      providers: [
        {
          provide: CurrentUserStoreService,
          useValue: {
            user$: of({ uid: 'u1' }),
          },
        },
        {
          provide: SuggestionService,
          useValue: {
            getSuggestedProfilesForUser: () => of([]),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(SuggestedProfilesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
