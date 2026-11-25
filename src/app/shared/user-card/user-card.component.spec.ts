// src/app/shared/user-card/user-card.component.spec.ts
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { RouterTestingModule } from '@angular/router/testing';
import { MatDialog } from '@angular/material/dialog';
import { vi } from 'vitest';
import { BehaviorSubject, Subject, of } from 'rxjs';
import { Router } from '@angular/router';
import { selectCurrentUser } from 'src/app/store/selectors/selectors.user/user.selectors';
import { selectAllFriends } from 'src/app/store/selectors/selectors.interactions/friends';
import { DirectChatAvailabilityService } from '../../messaging/direct-chat/services/direct-chat-availability.service';

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
        { provide: DirectChatAvailabilityService, useValue: {
          observeForCurrentUser$: vi.fn(() => of(false)),
          observeSessionOwner$: vi.fn(() => of(true)),
        } },
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

  it('normaliza o mesmo perfil legado para a prévia rápida sem promover uid privado', () => {
    expect(fixture.componentInstance.publicPreview()).toMatchObject({
      identity: {
        profileId: null,
        nickname: 'Perfil teste',
        identityShortLabel: 'Mulher',
        city: 'Niterói',
        state: 'RJ',
      },
    });
    expect('age' in (fixture.componentInstance.publicPreview() ?? {})).toBe(false);
    expect('orientationLabel' in (fixture.componentInstance.publicPreview() ?? {}))
      .toBe(false);
    expect(
      fixture.debugElement.query(By.css('.user-card__quick-preview'))
    ).toBeTruthy();
  });

  it('mostra sinais públicos autorizados e encaixe de desejos sem score bruto', () => {
    fixture.componentRef.setInput('user', {
      ...baseProfile,
      preferenceBadgesVisible: true,
      publicRelationshipIntents: ['serious'],
      publicBodyTraits: ['tattoos'],
      publicSexualPractices: ['bdsm'],
    });
    fixture.componentRef.setInput('preferenceMatchScore', 1);
    fixture.componentRef.setInput('preferenceMatchReasons', [
      'relationship_intent',
      'sexual_practice',
      'body_trait',
    ]);
    fixture.detectChanges();

    expect(
      fixture.componentInstance.publicPreview()?.highlights
    ).toEqual(
      expect.arrayContaining(['Sério', 'Tatuagens', 'BDSM'])
    );

    const desireMatch = fixture.debugElement.query(
      By.css('.user-card__desire-match')
    ).nativeElement as HTMLElement;

    expect(desireMatch.textContent).toContain('Desejos bem alinhados');
    expect(desireMatch.textContent).toContain('intenção');
    expect(desireMatch.textContent).toContain('práticas');
    expect(desireMatch.textContent).toContain('características');
    expect(desireMatch.textContent).not.toMatch(/\d+%/u);
  });

  it('destaca disponibilidade simultânea sem transformar contexto em score', () => {
    fixture.componentRef.setInput('intentAvailability', 'available_now');
    fixture.componentRef.setInput('mutualAvailableNow', true);
    fixture.detectChanges();

    const context = fixture.debugElement.query(
      By.css('.user-card__intent-context')
    ).nativeElement as HTMLElement;

    expect(context.textContent).toContain('Vocês estão disponíveis agora');
    expect(context.textContent).toContain('Momento em comum');
    expect(context.textContent).not.toMatch(/\d+%/u);
  });

  it('não mostra sinais públicos quando o perfil não autorizou badges', () => {
    fixture.componentRef.setInput('user', {
      ...baseProfile,
      preferenceBadgesVisible: false,
      publicRelationshipIntents: ['serious'],
      publicBodyTraits: ['tattoos'],
      publicSexualPractices: ['bdsm'],
    });
    fixture.detectChanges();

    expect(fixture.componentInstance.publicPreview()?.highlights).toEqual([]);
  });

  it('prioriza o código canônico de casal sem orientação agregada no card', () => {
    fixture.componentRef.setInput('user', {
      ...baseProfile,
      identityCode: 'casal-ele-ela',
      orientation: 'bissexual',
    });
    fixture.detectChanges();

    const identity = fixture.debugElement.query(
      By.css('app-public-user-identity')
    ).nativeElement as HTMLElement;
    expect(identity.textContent).toContain('Casal');
    expect(identity.textContent).not.toContain('Bi');
    expect(identity.textContent).not.toContain('Bissexual');
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

  it('mostra orientação uma vez na identidade e distância separada sem idade exata', () => {
    fixture.componentRef.setInput('distanciaKm', 4.2);
    fixture.detectChanges();

    const identity = fixture.debugElement.query(
      By.css('app-public-user-identity')
    ).nativeElement as HTMLElement;
    const location = fixture.debugElement.query(
      By.css('.user-card__location')
    ).nativeElement as HTMLElement;

    expect(identity.textContent).toContain('Mulher');
    expect(identity.textContent).toContain('Bi');
    expect(identity.textContent).toContain('Niterói/RJ');
    expect(fixture.debugElement.query(By.css('.user-card__meta'))).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('31 anos');
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
    const accessibleText = unavailableDebug.query(By.css('.visually-hidden'))
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

  it('mantém ação de mensagem visível e acessível sem conexão, sem abrir modal', () => {
    const button = fixture.debugElement.query(
      By.css('.user-card__action--message')
    ).nativeElement as HTMLButtonElement;
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('aria-label')).toContain('Conecte-se para conversar');
    button.click();
    expect(TestBed.inject(MatDialog).open).not.toHaveBeenCalled();
    expect(TestBed.inject(ErrorNotificationService).showInfo)
      .toHaveBeenCalledWith('Conecte-se para conversar.');
  });
  it('descarta resultado de modal antigo após perda de sessão e permite uma nova abertura', () => {
    const access$ = new BehaviorSubject(true);
    const session$ = new BehaviorSubject(true);
    const service = TestBed.inject(DirectChatAvailabilityService);
    vi.mocked(service.observeForCurrentUser$).mockReturnValue(access$);
    vi.mocked(service.observeSessionOwner$).mockReturnValue(session$);
    storeMock.select.mockImplementation((selector: unknown) => {
      if (selector === selectCurrentUser) return of({ uid: 'owner' });
      if (selector === selectAllFriends) return of([{ friendUid: 'u1' }]);
      return of(null);
    });
    fixture.destroy();
    fixture = TestBed.createComponent(UserCardComponent);
    fixture.componentRef.setInput('user', baseProfile);
    fixture.detectChanges();
    TestBed.tick();
    const card = fixture.componentInstance;
    expect(card.canMessageNow()).toBe(true);
    const oldResult$ = new Subject<any>();
    const dialog = TestBed.inject(MatDialog);
    vi.mocked(dialog.open).mockReturnValue({ afterClosed: () => oldResult$ } as any);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    card.abrirDM(new Event('click'));
    expect(dialog.open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      data: { profile: baseProfile, expectedOwnerUid: 'owner' },
    }));
    session$.next(false);
    session$.next(true);
    oldResult$.next({ ok: true, chatId: 'old-chat', targetUid: 'u1', messageId: 'old' });
    expect(navigate).not.toHaveBeenCalled();
    expect(oldResult$.observers.length).toBe(0);
    const freshResult$ = new Subject<any>();
    vi.mocked(dialog.open).mockReturnValue({ afterClosed: () => freshResult$ } as any);
    card.abrirDM(new Event('click'));
    freshResult$.next({ ok: true, chatId: 'new-chat', targetUid: 'u1', messageId: 'new' });
    expect(navigate).toHaveBeenCalledWith(['/chat'], {
      queryParams: { openChatId: 'new-chat', withUser: 'u1' },
    });
  });
});
