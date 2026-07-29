import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, beforeEach, expect, it } from 'vitest';

import { ImageFallbackDirective } from './image-fallback.directive';

@Component({
  standalone: true,
  imports: [ImageFallbackDirective],
  template: `
    <img
      class="user-photo"
      [src]="source"
      alt="Foto do usuário"
    />
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
  });

  it('mantém o fallback padrão quando a diretiva é usada somente como marcador', () => {
    markerPhoto.dispatchEvent(new Event('error'));

    expect(markerPhoto.getAttribute('src')).toBe('assets/imagem-padrao.webp');
  });

  it('não entra em loop quando o fallback também falha', () => {
    userPhoto.dispatchEvent(new Event('error'));
    userPhoto.dispatchEvent(new Event('error'));

    expect(userPhoto.getAttribute('src')).toBe('assets/imagem-padrao.webp');
  });
});
