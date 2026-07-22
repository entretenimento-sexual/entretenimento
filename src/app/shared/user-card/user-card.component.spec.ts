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

  it('prioriza foto e identidade sem exibir plano ou status offline', () => {
    expect(fixture.debugElement.query(By.css('.user-card__media'))).toBeTruthy();
    expect(fixture.debugElement.query(By.css('.user-card__name')).nativeElement.textContent)
      .toContain('Perfil teste');
    expect(fixture.debugElement.query(By.css('.user-card__tier'))).toBeNull();
    expect(fixture.debugElement.query(By.css('.user-card__presence'))).toBeNull();
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
  });

  it('consolida identidade sexual, localização e distância', () => {
    fixture.componentRef.setInput('distanciaKm', 4.2);
    fixture.detectChanges();

    const metadata = fixture.debugElement.query(
      By.css('.user-card__meta')
    ).nativeElement as HTMLElement;
    const location = fixture.debugElement.query(
      By.css('.user-card__location')
    ).nativeElement as HTMLElement;

    expect(metadata.textContent).toContain('Mulher');
    expect(metadata.textContent).toContain('31 anos');
    expect(metadata.textContent).toContain('Bissexual');
    expect(location.textContent).toContain('Niterói');
    expect(location.textContent).toMatch(/4[,.]2 km/);
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
