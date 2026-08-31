// src/app/shared/user-card/user-card.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RouterTestingModule } from '@angular/router/testing';
import { MatDialog } from '@angular/material/dialog';
import { vi } from 'vitest';

import { UserCardComponent } from './user-card.component';
import { ErrorNotificationService } from '../../core/services/error-handler/error-notification.service';
import {
  createStoreTestingMock,
  provideStoreTestingMock,
  StoreTestingMock,
} from '../../../test/ngrx-store-testing.providers';

describe('UserCardComponent', () => {
  let fixture: ComponentFixture<UserCardComponent>;
  let storeMock: StoreTestingMock;

  const baseProfile = {
    uid: 'u1',
    nickname: 'Perfil teste',
    photoURL: 'https://example.test/profile.jpg',
    gender: 'mulher',
    idade: 31,
    orientation: 'bissexual',
    municipio: 'Niterói',
    estado: 'RJ',
    role: 'vip',
    isOnline: false,
  } as any;

  beforeEach(async () => {
    storeMock = createStoreTestingMock();

    await TestBed.configureTestingModule({
      imports: [
        RouterTestingModule,
        UserCardComponent,
      ],
      providers: [
        ...provideStoreTestingMock(storeMock),
        {
          provide: MatDialog,
          useValue: {
            open: vi.fn(),
          },
        },
        {
          provide: ErrorNotificationService,
          useValue: {
            showInfo: vi.fn(),
            showError: vi.fn(),
            showSuccess: vi.fn(),
            showWarning: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(UserCardComponent);
    fixture.componentRef.setInput('user', baseProfile);
    fixture.detectChanges();
  });

  it('deve criar', () => {
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('usa a identidade pública canônica sobre a foto', () => {
    expect(fixture.debugElement.query(By.css('.user-card__media'))).toBeTruthy();

    const identity = fixture.debugElement.query(
      By.css('app-public-user-identity')
    ).nativeElement as HTMLElement;

    expect(identity.textContent).toContain('Perfil teste');
    expect(identity.textContent).toContain('Mulher');
    expect(identity.textContent).toContain('Niterói');
    expect(identity.textContent).toContain('RJ');
    expect(fixture.debugElement.query(By.css('.user-card__tier'))).toBeNull();
    expect(fixture.debugElement.query(By.css('.user-card__presence'))).toBeNull();
  });

  it('normaliza o mesmo perfil legado para a prévia rápida', () => {
    expect(fixture.componentInstance.publicPreview()).toMatchObject({
      age: 31,
      orientationLabel: 'bissexual',
      identity: {
        profileId: 'u1',
        nickname: 'Perfil teste',
        identityShortLabel: 'Mulher',
        city: 'Niterói',
        state: 'RJ',
      },
    });
    expect(
      fixture.debugElement.query(By.css('.user-card__quick-preview'))
    ).toBeTruthy();
  });

  it('usa a imagem padrão quando a URL do perfil falha ao carregar', () => {
    const image = fixture.debugElement.query(
      By.css('.user-card__photo')
    ).nativeElement as HTMLImageElement;

    image.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(image.getAttribute('data-image-fallback')).toBe('applied');
    expect(image.src).toContain('/assets/imagem-padrao.webp');
  });

  it('exibe presença visual somente quando o perfil está online', () => {
    fixture.componentRef.setInput('user', {
      ...baseProfile,
      isOnline: true,
    });
    fixture.detectChanges();

    const presence = fixture.debugElement.query(
      By.css('.user-card__presence')
    ).nativeElement as HTMLElement;

    expect(presence.textContent).toContain('Online');
    expect(fixture.componentInstance.publicPreview()?.isOnline).toBe(true);
  });

  it('mantém idade, orientação e distância como contexto sem duplicar identidade/localização', () => {
    fixture.componentRef.setInput('distanciaKm', 4.2);
    fixture.detectChanges();

    const metadata = fixture.debugElement.query(
      By.css('.user-card__meta')
    ).nativeElement as HTMLElement;
    const location = fixture.debugElement.query(
      By.css('.user-card__location')
    ).nativeElement as HTMLElement;

    expect(metadata.textContent).toContain('31 anos');
    expect(metadata.textContent).toContain('Bissexual');
    expect(metadata.textContent).not.toContain('Mulher');
    expect(location.textContent).toMatch(/4[,.]2 km/);
    expect(location.textContent).not.toContain('Niterói');
    expect(
      fixture.debugElement.query(By.css('.user-card__distance-unavailable'))
    ).toBeNull();
  });

  it('usa marcador compacto e acessível quando a distância não pode ser calculada', () => {
    fixture.componentRef.setInput('distanciaKm', null);
    fixture.detectChanges();

    const unavailableDebug = fixture.debugElement.query(
      By.css('.user-card__distance-unavailable')
    );
    const unavailable = unavailableDebug.nativeElement as HTMLElement;
    const accessibleText = unavailableDebug.query(By.css('.sr-only'))
      .nativeElement as HTMLElement;

    expect(unavailable.textContent).toContain('—');
    expect(unavailable.getAttribute('title')).toBe('Distância não disponível');
    expect(accessibleText.textContent).toContain('Distância não disponível');
    expect(unavailable.textContent).not.toContain('Distância indisponível');
  });

  it('não repete a navegação do perfil entre as ações', () => {
    expect(fixture.debugElement.query(By.css('.user-card__media'))).toBeTruthy();
    expect(
      fixture.debugElement.query(
        By.css('.user-card__actions [title="Ver perfil"]')
      )
    ).toBeNull();
  });
});
