import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { By } from '@angular/platform-browser';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PublicPhotoCardComponent } from './public-photo-card.component';
import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';

describe('PublicPhotoCardComponent', () => {
  let fixture: ComponentFixture<PublicPhotoCardComponent>;

  const photo: IPublicPhotoItem = {
    id: 'photo-1',
    ownerUid: 'user-1',
    ownerNickname: 'Pessoa teste',
    ownerPhotoURL: 'https://example.test/avatar.jpg',
    ownerGender: 'Mulher',
    ownerOrientation: 'Bissexual',
    ownerMunicipio: 'Rio de Janeiro',
    ownerEstado: 'RJ',
    url: 'https://example.test/photo.jpg',
    caption: 'Legenda persistente da publicação.',
    createdAt: Date.now() - 60_000,
    publishedAt: Date.now() - 60_000,
    visibility: 'PUBLIC',
    orderIndex: 0,
    reactionsCount: 3,
    commentsCount: 2,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PublicPhotoCardComponent],
      providers: [provideRouter([])],
    }).compileComponents();

    fixture = TestBed.createComponent(PublicPhotoCardComponent);
    fixture.componentRef.setInput('photo', photo);
    fixture.componentRef.setInput('variant', 'feed');
    fixture.detectChanges();
  });

  it('agrupa avatar, autor e horário em uma identidade compacta', () => {
    const header = fixture.debugElement.query(By.css('.feed-card-header'));
    const owner = fixture.debugElement.query(By.css('.feed-card-owner'))
      .nativeElement as HTMLAnchorElement;
    const identity = fixture.debugElement.query(
      By.css('.feed-card-owner__identity')
    ).nativeElement as HTMLElement;
    const avatar = fixture.debugElement.query(By.css('.feed-card-avatar'))
      .nativeElement as HTMLImageElement;

    expect(header).toBeTruthy();
    expect(owner.textContent).toContain('Pessoa teste');
    expect(identity.textContent).toContain('há 1 min');
    expect(owner.textContent).not.toContain('Rio de Janeiro');
    expect(avatar.src).toContain('avatar.jpg');
  });

  it('exibe a legenda persistente antes da mídia', () => {
    const caption = fixture.debugElement.query(
      By.css('.feed-card-caption')
    ).nativeElement as HTMLElement;
    const media = fixture.debugElement.query(By.css('.photo-card-link--feed'));

    expect(caption.textContent?.trim()).toBe('Legenda persistente da publicação.');
    expect(
      caption.compareDocumentPosition(media.nativeElement) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('usa a inicial do autor quando não existe avatar público', () => {
    fixture.componentRef.setInput('photo', {
      ...photo,
      ownerPhotoURL: null,
    });
    fixture.detectChanges();

    const fallback = fixture.debugElement.query(
      By.css('.feed-card-avatar--fallback')
    ).nativeElement as HTMLElement;

    expect(fallback.textContent?.trim()).toBe('P');
  });

  it('mantém o impulso junto dos metadados da publicação', () => {
    fixture.componentRef.setInput('photo', {
      ...photo,
      boostActive: true,
    });
    fixture.detectChanges();

    const metadata = fixture.debugElement.query(
      By.css('.feed-card-owner__meta')
    ).nativeElement as HTMLElement;
    const boost = fixture.debugElement.query(
      By.css('.feed-card-boosted')
    ).nativeElement as HTMLElement;

    expect(metadata.contains(boost)).toBe(true);
    expect(boost.textContent).toContain('Impulsionada');
  });

  it('não usa overlay nem rodapé duplicado da variante latest', () => {
    expect(fixture.debugElement.query(By.css('.photo-overlay'))).toBeNull();
    expect(fixture.debugElement.query(By.css('.photo-meta'))).toBeNull();
    expect(fixture.debugElement.query(By.css('.feed-card-footer'))).toBeTruthy();
  });

  it('oculta o rodapé quando não há engajamento, mesmo com impulso', () => {
    fixture.componentRef.setInput('photo', {
      ...photo,
      reactionsCount: 0,
      commentsCount: 0,
      boostActive: true,
    });
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('.feed-card-footer'))).toBeNull();
    expect(fixture.debugElement.query(By.css('.feed-card-boosted'))).toBeTruthy();
  });

  it('mantém a mídia como botão acessível para abrir o lightbox', () => {
    const mediaButton = fixture.debugElement.query(
      By.css('.photo-card-link--feed')
    ).nativeElement as HTMLButtonElement;

    expect(mediaButton.type).toBe('button');
    expect(mediaButton.getAttribute('aria-label')).toContain('Pessoa teste');
  });

  it('emite preview ao abrir a publicação', () => {
    const previewSpy = vi.fn();
    fixture.componentInstance.preview.subscribe(previewSpy);

    fixture.debugElement
      .query(By.css('.photo-card-link--feed'))
      .triggerEventHandler('click', null);

    expect(previewSpy).toHaveBeenCalledTimes(1);
  });
});
