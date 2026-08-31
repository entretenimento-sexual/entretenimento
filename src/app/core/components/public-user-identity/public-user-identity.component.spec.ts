// src/app/core/components/public-user-identity/public-user-identity.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { PublicUserIdentityComponent } from './public-user-identity.component';

describe('PublicUserIdentityComponent', () => {
  let fixture: ComponentFixture<PublicUserIdentityComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PublicUserIdentityComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(PublicUserIdentityComponent);
  });

  it('renderiza nickname, identidade, cidade/UF e contexto no formato canônico', () => {
    fixture.componentRef.setInput('identity', {
      profileId: 'user-1',
      nickname: 'serale',
      label: 'serale',
      avatarUrl: 'https://example.com/avatar.webp',
      identityCode: 'mulher',
      city: 'Rio de Janeiro',
      state: 'RJ',
    });
    fixture.componentRef.setInput('contextText', 'há 3 horas');
    fixture.componentRef.setInput('contextDateTime', '2026-08-31T18:00:00.000Z');
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('serale');
    expect(element.textContent).toContain('Mulher');
    expect(element.textContent).toContain('Rio de Janeiro/RJ');
    expect(element.textContent).toContain('há 3 horas');
    expect(element.querySelector('time')?.getAttribute('datetime')).toBe(
      '2026-08-31T18:00:00.000Z'
    );
  });

  it('aceita aliases legados somente como ponte visual de migração', () => {
    fixture.componentRef.setInput('identity', {
      label: 'perfil legado',
      avatarUrl: null,
      profileTypeLabel: 'Casal',
      city: 'Niterói',
      state: 'RJ',
    });
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('perfil legado');
    expect(element.textContent).toContain('Casal');
    expect(element.textContent).toContain('Niterói/RJ');
  });

  it('usa fallback discreto quando a identidade não está disponível', () => {
    fixture.componentRef.setInput('identity', null);
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.textContent).toContain('Usuário');
    expect(element.textContent).not.toContain('undefined');
    expect(element.textContent).not.toContain('null');
  });

  it('reutiliza o fallback visual canônico quando a imagem quebra', () => {
    fixture.componentRef.setInput('identity', {
      nickname: 'serale',
      label: 'serale',
      avatarUrl: 'https://example.com/avatar.webp',
    });
    fixture.detectChanges();

    const image = fixture.nativeElement.querySelector('img') as HTMLImageElement;
    expect(image.getAttribute('alt')).toBe('');

    image.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    const fallbackImage = fixture.nativeElement.querySelector('img') as HTMLImageElement;
    expect(fallbackImage).toBeTruthy();
    expect(fallbackImage.getAttribute('data-image-fallback')).toBe('applied');
    expect(fallbackImage.src).toContain('/assets/imagem-padrao.webp');
  });
});
