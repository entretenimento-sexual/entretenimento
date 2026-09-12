import {
  Directive,
  ElementRef,
  HostListener,
  Input,
  Renderer2,
  inject,
} from '@angular/core';

const DEFAULT_IMAGE_FALLBACK = 'assets/imagem-padrao.webp';

/**
 * Aplica uma imagem alternativa quando o carregamento da imagem principal falha.
 *
 * O seletor por atributo permite reutilização explícita em qualquer avatar ou
 * imagem. O seletor `img.user-photo` mantém compatibilidade com o navbar sem
 * acoplar regra de fallback ao componente de autenticação.
 *
 * O input aceita uso como marcador (`appImageFallback`) ou com fonte customizada.
 * Valor ausente/vazio preserva o fallback padrão em vez de desativá-lo.
 *
 * Se até a imagem de fallback falhar, a tag é ocultada e fica marcada como
 * `data-image-fallback="failed"`. Isso evita que o navegador exiba seu ícone
 * nativo de imagem quebrada e permite que o contêiner mostre iniciais/placeholder.
 */
@Directive({
  selector: 'img[appImageFallback], img.user-photo',
  standalone: true,
})
export class ImageFallbackDirective {
  private readonly elementRef = inject<ElementRef<HTMLImageElement>>(ElementRef);
  private readonly renderer = inject(Renderer2);

  private fallbackSource = DEFAULT_IMAGE_FALLBACK;

  @Input()
  set appImageFallback(value: string | null | undefined) {
    this.fallbackSource = String(value ?? '').trim() || DEFAULT_IMAGE_FALLBACK;
  }

  get appImageFallback(): string {
    return this.fallbackSource;
  }

  @HostListener('error')
  onImageError(): void {
    const image = this.elementRef.nativeElement;
    const fallback = this.fallbackSource;
    const resolvedFallback = this.resolveUrl(fallback, image);
    const currentSource = image.currentSrc || image.src;

    if (currentSource === resolvedFallback) {
      this.renderer.removeAttribute(image, 'srcset');
      this.renderer.removeAttribute(image, 'src');
      this.renderer.setAttribute(image, 'data-image-fallback', 'failed');
      this.renderer.setStyle(image, 'visibility', 'hidden');
      return;
    }

    this.renderer.removeAttribute(image, 'srcset');
    this.renderer.setAttribute(image, 'data-image-fallback', 'applied');
    this.renderer.removeStyle(image, 'visibility');
    this.renderer.setProperty(image, 'src', fallback);
  }

  @HostListener('load')
  onImageLoad(): void {
    const image = this.elementRef.nativeElement;
    const currentSource = image.currentSrc || image.src;
    const resolvedFallback = this.resolveUrl(this.fallbackSource, image);

    this.renderer.removeStyle(image, 'visibility');

    if (currentSource !== resolvedFallback) {
      this.renderer.removeAttribute(image, 'data-image-fallback');
    }
  }

  private resolveUrl(value: string, image: HTMLImageElement): string {
    try {
      return new URL(value, image.ownerDocument.baseURI).href;
    } catch {
      return value;
    }
  }
}
