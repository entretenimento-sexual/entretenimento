import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { MatDialog } from '@angular/material/dialog';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IPublicPhotoItem } from 'src/app/core/interfaces/media/i-public-photo-item';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { MediaPublicQueryService } from 'src/app/core/services/media/media-public-query.service';
import { ProfileMediaShowcaseComponent } from './profile-media-showcase.component';


describe('ProfileMediaShowcaseComponent', () => {
  let fixture: ComponentFixture<ProfileMediaShowcaseComponent>;

  const photo: IPublicPhotoItem = {
    id: 'photo-1',
    ownerUid: 'target-uid',
    mediaType: 'PHOTO',
    url: 'https://example.test/photo.jpg',
    alt: 'Foto pública de teste',
    createdAt: Date.now(),
    publishedAt: Date.now(),
    visibility: 'PUBLIC',
    orderIndex: 0,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProfileMediaShowcaseComponent],
      providers: [
        provideRouter([]),
        {
          provide: MatDialog,
          useValue: {
            open: vi.fn(),
          },
        },
        {
          provide: MediaPublicQueryService,
          useValue: {
            getProfilePublicMedia$: vi.fn(() => of([photo])),
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showError: vi.fn(),
            showWarning: vi.fn(),
          },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: {
            handleError: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(ProfileMediaShowcaseComponent);
    fixture.componentRef.setInput('ownerUid', 'target-uid');
    fixture.componentRef.setInput('profileName', 'Pessoa alvo');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('renderiza a mídia como conteúdo principal', () => {
    const item = fixture.debugElement.query(
      By.css('.profile-media-showcase__item')
    );
    const image = item.query(By.css('img')).nativeElement as HTMLImageElement;

    expect(item).toBeTruthy();
    expect(image.src).toContain('photo.jpg');
    expect(item.nativeElement.getAttribute('aria-label')).toContain(
      'Pessoa alvo'
    );
  });

  it('não renderiza cabeçalho, contadores ou instruções duplicadas', () => {
    const text = fixture.nativeElement.textContent as string;

    expect(
      fixture.debugElement.query(By.css('.profile-media-showcase__header'))
    ).toBeNull();
    expect(
      fixture.debugElement.query(By.css('.profile-media-showcase__summary'))
    ).toBeNull();
    expect(text).not.toContain('Mídias públicas');
    expect(text).not.toContain('Galeria de');
    expect(text).not.toContain('Toque em uma mídia');
    expect(text).not.toContain('Abrir destaque');
    expect(text).not.toContain('Capa');
  });

  it('mantém apenas o atalho compacto para a galeria completa', () => {
    const links = fixture.debugElement.query(
      By.css('.profile-media-showcase__links')
    ).nativeElement as HTMLElement;

    expect(links.textContent).toContain('Fotos');
    expect(links.textContent).not.toContain('Ver todas as fotos');
  });
});
