import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, beforeEach, expect, it } from 'vitest';

import { ImageFallbackDirective } from './image-fallback.directive';

@Component({
  standalone: true,
  imports: [ImageFallbackDirective],
  template: `
    <span class="avatar-shell">
      <span class="avatar-initial" aria-hidden="true">A</span>
      <img
        class="user-photo"
        [src]="source"
        alt="Foto do usuário"
      />
    </span>
    <img
      class="marker-photo"
      appImageFallback
      [src]="source"
      alt="Foto com marcador"
    />
  `,
})
class ImageFallbackHostComponent {
  source = 'https://example.invalid/avatar.webp';
}

describe('ImageFallbackDirective', () => {
  let fixture: ComponentFixture<ImageFallbackHostComponent>;
  let userPhoto: HTMLImageElement;
  let markerPhoto: HTMLImageElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ImageFallbackHostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ImageFallbackHostComponent);
    fixture.detectChanges();
    userPhoto = fixture.nativeElement.querySelector('.user-photo') as HTMLImageElement;
    markerPhoto = fixture.nativeElement.querySelector('.marker-photo') as HTMLImageElement;
  });

  it('substitui a imagem quebrada pelo fallback padrão', () => {
    userPhoto.dispatchEvent(new Event('error'));

    expect(userPhoto.getAttribute('src')).toBe('assets/imagem-padrao.webp');
    expect(userPhoto.getAttribute('data-image-fallback')).toBe('applied');
    expect(userPhoto.style.visibility).toBe('');
  });

  it('mantém o fallback padrão quando a diretiva é usada somente como marcador', () => {
    markerPhoto.dispatchEvent(new Event('error'));

    expect(markerPhoto.getAttribute('src')).toBe('assets/imagem-padrao.webp');
  });

  it('oculta a tag se o próprio fallback falhar, evitando o ícone nativo de imagem quebrada', () => {
    userPhoto.dispatchEvent(new Event('error'));
    userPhoto.dispatchEvent(new Event('error'));

    expect(userPhoto.hasAttribute('src')).toBe(false);
    expect(userPhoto.hasAttribute('srcset')).toBe(false);
    expect(userPhoto.getAttribute('data-image-fallback')).toBe('failed');
    expect(userPhoto.style.visibility).toBe('hidden');
  });

  it('restaura visibilidade e limpa o estado ao carregar novamente uma imagem válida', () => {
    userPhoto.dispatchEvent(new Event('error'));
    userPhoto.dispatchEvent(new Event('error'));

    const component = fixture.componentInstance;
    component.source = 'https://example.test/avatar-ok.webp';
    fixture.detectChanges();
    userPhoto.dispatchEvent(new Event('load'));

    expect(userPhoto.style.visibility).toBe('');
    expect(userPhoto.hasAttribute('data-image-fallback')).toBe(false);
  });
});