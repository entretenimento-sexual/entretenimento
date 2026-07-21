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

  it('renderiza identificação compacta com avatar, autor e horário', () => {
    const header = fixture.debugElement.query(By.css('.feed-card-header'));
    const owner = fixture.debugElement.query(By.css('.feed-card-owner'))
      .nativeElement as HTMLAnchorElement;
    const avatar = fixture.debugElement.query(By.css('.feed-card-avatar'))
      .nativeElement as HTMLImageElement;

    expect(header).toBeTruthy();
    expect(owner.textContent).toContain('Pessoa teste');
    expect(owner.textContent).not.toContain('Rio de Janeiro');
    expect(avatar.src).toContain('avatar.jpg');
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

  it('não usa overlay nem rodapé duplicado da variante latest', () => {
    expect(fixture.debugElement.query(By.css('.photo-overlay'))).toBeNull();
    expect(fixture.debugElement.query(By.css('.photo-meta'))).toBeNull();
    expect(fixture.debugElement.query(By.css('.feed-card-footer'))).toBeTruthy();
  });

  it('oculta o rodapé quando não há engajamento nem impulso', () => {
    fixture.componentRef.setInput('photo', {
      ...photo,
      reactionsCount: 0,
      commentsCount: 0,
      boostActive: false,
    });
    fixture.detectChanges();

    expect(fixture.debugElement.query(By.css('.feed-card-footer'))).toBeNull();
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
