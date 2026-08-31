import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RouterTestingModule } from '@angular/router/testing';

import { PublicUserPreviewPopoverComponent } from './public-user-preview-popover.component';
import type { PublicUserPreview } from '../../domain/public-user-preview/public-user-preview.model';

describe('PublicUserPreviewPopoverComponent', () => {
  let fixture: ComponentFixture<PublicUserPreviewPopoverComponent>;

  const preview: PublicUserPreview = {
    identity: {
      profileId: null,
      nickname: 'serale',
      label: 'serale',
      avatarUrl: 'https://example.test/avatar.webp',
      identityCode: 'mulher',
      identityLabel: 'Mulher',
      identityShortLabel: 'Mulher',
      discoveryGroup: 'woman',
      city: 'Rio de Janeiro',
      state: 'RJ',
      profileType: 'woman',
      profileTypeLabel: 'Mulher',
    },
    age: 31,
    orientationLabel: 'bissexual',
    isOnline: true,
    approximateDistanceKm: 4.2,
    bioPreview: 'Conversas, encontros e novas amizades.',
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        RouterTestingModule,
        PublicUserPreviewPopoverComponent,
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PublicUserPreviewPopoverComponent);
    fixture.componentRef.setInput('preview', preview);
    fixture.componentRef.setInput('relationshipLabel', 'Vocês estão conectados');
    fixture.componentRef.setInput('profileRoute', ['/perfil', 'user-public-1']);
    fixture.detectChanges();
  });

  it('renderiza identidade e contexto público com hierarquia canônica', () => {
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('serale');
    expect(text).toContain('Mulher');
    expect(text).toContain('Rio de Janeiro');
    expect(text).toContain('31 anos');
    expect(text).toContain('Bissexual');
    expect(text).toContain('Online');
    expect(text).toMatch(/4[,.]2 km/);
    expect(text).toContain('Vocês estão conectados');
    expect(text).toContain('Conversas, encontros e novas amizades.');
  });

  it('usa rota pública explícita sem exigir profileId na identidade', () => {
    const link = fixture.nativeElement.querySelector(
      '.public-user-preview__profile-link'
    ) as HTMLAnchorElement | null;
    const text = fixture.nativeElement.textContent as string;

    expect(preview.identity.profileId).toBeNull();
    expect(link).toBeTruthy();
    expect(link?.getAttribute('href')).toContain('/perfil/user-public-1');
    expect(text).not.toContain('KYC');
    expect(text).not.toContain('e-mail');
    expect(text).not.toContain('documento');
  });
});
