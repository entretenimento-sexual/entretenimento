import { Directive, ElementRef, HostListener, Input, Renderer2, inject } from '@angular/core';

/**
 * Aplica uma imagem alternativa quando o carregamento da imagem principal falha.
 *
 * O seletor por atributo permite reutilização explícita em outras telas. O seletor
 * `img.user-photo` mantém o avatar atual do navbar protegido sem acoplar regra de
 * fallback ao componente de autenticação.
 */
@Directive({
  selector: 'img[appImageFallback], img.user-photo',
  standalone: true,
})
export class ImageFallbackDirective {
  private readonly elementRef = inject<ElementRef<HTMLImageElement>>(ElementRef);
  private readonly renderer = inject(Renderer2);

  @Input() appImageFallback = 'assets/imagem-padrao.webp';

  @HostListener('error')
  onImageError(): void {
    const image = this.elementRef.nativeElement;
    const fallback = String(this.appImageFallback ?? '').trim();

    if (!fallback) {
      return;
    }

    const resolvedFallback = this.resolveUrl(fallback, image);
    const currentSource = image.currentSrc || image.src;

    // Evita loop quando a própria imagem de fallback também não estiver disponível.
    if (currentSource === resolvedFallback) {
      return;
    }

    this.renderer.removeAttribute(image, 'srcset');
    this.renderer.setProperty(image, 'src', fallback);
  }

  private resolveUrl(value: string, image: HTMLImageElement): string {
    try {
      return new URL(value, image.ownerDocument.baseURI).href;
    } catch {
      return value;
    }
  }
}
