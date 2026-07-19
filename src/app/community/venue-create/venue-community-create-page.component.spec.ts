// src/app/community/venue-create/venue-community-create-page.component.spec.ts
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { VenueCommunityRepository } from '../data-access/venue-community.repository';
import { VenueCommunityCreatePageComponent } from './venue-community-create-page.component';

describe('VenueCommunityCreatePageComponent', () => {
  const createVenueCommunity$ = vi.fn();
  const showWarning = vi.fn();
  const showSuccess = vi.fn();
  const showError = vi.fn();
  const handleError = vi.fn();

  beforeEach(async () => {
    vi.clearAllMocks();
    createVenueCommunity$.mockReturnValue(
      of({
        venueId: 'venue-request-1234567890',
        communityId: 'community-request-1234567890',
        created: true,
      })
    );

    await TestBed.configureTestingModule({
      imports: [VenueCommunityCreatePageComponent],
      providers: [
        provideRouter([]),
        {
          provide: VenueCommunityRepository,
          useValue: { createVenueCommunity$ },
        },
        {
          provide: ErrorNotificationService,
          useValue: { showWarning, showSuccess, showError },
        },
        {
          provide: GlobalErrorHandlerService,
          useValue: { handleError },
        },
      ],
    }).compileComponents();
  });

  it('bloqueia envio incompleto com feedback de Local', () => {
    const fixture = TestBed.createComponent(VenueCommunityCreatePageComponent);
    const component = fixture.componentInstance;

    component.submit();

    expect(showWarning).toHaveBeenCalledWith(
      'Revise os campos obrigatórios do Local.'
    );
    expect(createVenueCommunity$).not.toHaveBeenCalled();
  });

  it('cria Local, preserva owner no backend e abre a rota canônica', () => {
    const fixture = TestBed.createComponent(VenueCommunityCreatePageComponent);
    const component = fixture.componentInstance;
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    component.form.setValue({
      name: 'Espaço Funcional',
      kind: 'event_space',
      description: 'Eventos e atualizações do Local.',
      uf: 'rj',
      city: 'Rio de Janeiro',
      district: 'Centro',
      addressHint: 'Região central',
      joinPolicy: 'approval',
    });

    component.submit();

    expect(createVenueCommunity$).toHaveBeenCalledTimes(1);
    expect(createVenueCommunity$.mock.calls[0][0]).toMatchObject({
      name: 'Espaço Funcional',
      kind: 'event_space',
      region: {
        uf: 'RJ',
        city: 'rio de janeiro',
        district: 'Centro',
      },
      joinPolicy: 'approval',
    });
    expect(showSuccess).toHaveBeenCalledWith('Local criado.');
    expect(navigate).toHaveBeenCalledWith([
      '/dashboard/locais',
      'community-request-1234567890',
    ]);
  });

  it('expõe a definição canônica de Local na tela', () => {
    const fixture = TestBed.createComponent(VenueCommunityCreatePageComponent);

    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Lugar físico ou estabelecimento real.'
    );
    expect(fixture.nativeElement.textContent).toContain(
      'Você será o Proprietário deste Local.'
    );
    expect(fixture.nativeElement.textContent).not.toContain(
      'proprietário da comunidade vinculada'
    );
  });
});
