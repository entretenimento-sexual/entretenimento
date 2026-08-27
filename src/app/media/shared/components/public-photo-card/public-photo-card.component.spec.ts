import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { By } from '@angular/platform-browser';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { PublicPhotoCardComponent } from './public-photo-card.component';
import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import { MediaReactionsService } from 'src/app/core/services/media/media-reactions.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';

describe('PublicPhotoCardComponent', () => {
  let fixture: ComponentFixture<PublicPhotoCardComponent>;

  const reactions = {
    isPhotoLikedByViewer$: vi.fn(() => of(false)),
    isVideoLikedByViewer$: vi.fn(() => of(false)),
    toggleLikePhotoWithState$: vi.fn(() =>
      of({ liked: true, reactionsCount: 4, score: 0 })
    ),
    toggleLikeVideoWithState$: vi.fn(() =>
      of({ liked: true, reactionsCount: 4, score: 0 })
    ),
  };

  const notifications = {
    showWarning: vi.fn(),
  };

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
    reactionsEnabled: true,
    commentsEnabled: true,
    reactionsCount: 3,
    commentsCount: 2,
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    await TestBed.configureTestingModule({
      imports: [PublicPhotoCardComponent],
      providers: [
        provideRouter([]),
        { provide: MediaReactionsService, useValue: reactions },
        { provide: ErrorNotificationService, useValue: notifications },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(PublicPhotoCardComponent);
    fixture.componentRef.setInput('photo', photo);
    fixture.componentRef.setInput('variant', 'feed');
    fixture.componentRef.setInput('viewerUid', 'viewer-1');
    fixture.componentRef.setInput('engagementActions', true);
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

  it('mantém ações disponíveis mesmo quando os contadores começam zerados', () => {
    fixture.componentRef.setInput('photo', {
      ...photo,
      reactionsCount: 0,
      commentsCount: 0,
      boostActive: true,
    });
    fixture.detectChanges();

    const footer = fixture.debugElement.query(By.css('.feed-card-footer'));
    const actions = fixture.debugElement.queryAll(
      By.css('app-public-media-engagement-actions button')
    );

    expect(footer).toBeTruthy();
    expect(actions).toHaveLength(2);
    expect(actions[0].nativeElement.textContent).toContain('0');
    expect(actions[1].nativeElement.textContent).toContain('0');
    expect(fixture.debugElement.query(By.css('.feed-card-boosted'))).toBeTruthy();
  });

  it('preserva o comportamento legado quando ações não são habilitadas', () => {
    fixture.componentRef.setInput('engagementActions', false);
    fixture.componentRef.setInput('photo', {
      ...photo,
      reactionsCount: 0,
      commentsCount: 0,
    });
    fixture.detectChanges();

    expect(
      fixture.debugElement.query(By.css('app-public-media-engagement-actions'))
    ).toBeNull();
    expect(fixture.debugElement.query(By.css('.feed-card-footer'))).toBeNull();
  });

  it('mantém a mídia como botão acessível para abrir o visualizador', () => {
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

  it('propaga o pedido de comentários para o container abrir o viewer canônico', () => {
    const commentsSpy = vi.fn();
    fixture.componentInstance.commentsRequested.subscribe(commentsSpy);

    fixture.debugElement
      .queryAll(By.css('app-public-media-engagement-actions button'))[1]
      .triggerEventHandler('click', null);

    expect(commentsSpy).toHaveBeenCalledTimes(1);
  });
});
