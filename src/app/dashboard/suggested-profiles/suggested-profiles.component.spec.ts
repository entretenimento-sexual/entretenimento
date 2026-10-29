import { ComponentFixture, TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { provideRouter } from '@angular/router';

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
        provideRouter([]),
        {
          provide: CurrentUserStoreService,
          useValue: {
            user$: of({ uid: 'u1' }),
          },
        },
        {
          provide: SuggestionService,
          useValue: {
            getSuggestedProfilesForUser: () => of([{
              uid: 'u2',
              nickname: 'casal_publico',
              identityCode: 'casal-ele-ela',
              gender: 'mulher',
              orientation: 'bissexual',
              municipio: 'Rio de Janeiro',
              estado: 'RJ',
              photoURL: null,
              idade: 42,
              isSubscriber: true,
              subscriptionStatus: 'active',
            }]),
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

  it('usa apenas identificação canônica sem idade, orientação presumida ou plano', () => {
    const root = fixture.nativeElement as HTMLElement;
    const identity = root.querySelector('app-public-user-identity') as HTMLElement;

    expect(identity).not.toBeNull();
    expect(root.querySelector('.profile-card__heading h2')?.textContent)
      .toContain('casal_publico');
    expect(identity.textContent).toContain('Casal');
    expect(identity.textContent).toContain('Rio de Janeiro/RJ');
    expect(identity.textContent).not.toContain('Bi');
    expect(identity.textContent).not.toContain('bissexual');
    expect(root.textContent).not.toContain('42 anos');
    expect(root.textContent).not.toContain('Assinante');
    expect(root.querySelector('.profile-card__age')).toBeNull();
  });
});
