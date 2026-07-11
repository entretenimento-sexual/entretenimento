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
  `,
})
class ImageFallbackHostComponent {
  source = 'https://example.invalid/avatar.webp';
}

describe('ImageFallbackDirective', () => {
  let fixture: ComponentFixture<ImageFallbackHostComponent>;
  let image: HTMLImageElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ImageFallbackHostComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(ImageFallbackHostComponent);
    fixture.detectChanges();
    image = fixture.nativeElement.querySelector('img') as HTMLImageElement;
  });

  it('deve substituir a imagem quebrada pelo fallback padrão', () => {
    image.dispatchEvent(new Event('error'));

    expect(image.getAttribute('src')).toBe('assets/imagem-padrao.webp');
  });

  it('não deve entrar em loop quando o fallback também falhar', () => {
    image.dispatchEvent(new Event('error'));
    image.dispatchEvent(new Event('error'));

    expect(image.getAttribute('src')).toBe('assets/imagem-padrao.webp');
  });
});
