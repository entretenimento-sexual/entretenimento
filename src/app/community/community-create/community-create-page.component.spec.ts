// src/app/community/community-create/community-create-page.component.spec.ts
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { CommunityCreateRepository } from '../data-access/community-create.repository';
import { CommunityCreatePageComponent } from './community-create-page.component';

describe('CommunityCreatePageComponent', () => {
  const createCommunity$ = vi.fn();
  const showWarning = vi.fn();
  const showSuccess = vi.fn();
  const showError = vi.fn();
  const handleError = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    createCommunity$.mockReturnValue(
      of({
        communityId: 'community-created-1',
        created: true,
      })
    );

    TestBed.configureTestingModule({
      imports: [CommunityCreatePageComponent],
      providers: [
        provideRouter([]),
        {
          provide: CommunityCreateRepository,
          useValue: { createCommunity$ },
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
    });
  });

  it('bloqueia envio inválido e apresenta feedback', () => {
    const fixture = TestBed.createComponent(CommunityCreatePageComponent);
    fixture.detectChanges();

    fixture.componentInstance.submit();

    expect(createCommunity$).not.toHaveBeenCalled();
    expect(showWarning).toHaveBeenCalledWith(
      'Revise os campos obrigatórios da Comunidade.'
    );
  });

  it('cria a Comunidade e navega para o detalhe canônico', () => {
    const fixture = TestBed.createComponent(CommunityCreatePageComponent);
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    const component = fixture.componentInstance;

    component.form.setValue({
      name: 'Comunidade Funcional',
      theme: 'interests',
      description: 'Grupo funcional para validação.',
      rules: 'Respeite a privacidade de todos os participantes.',
      joinPolicy: 'approval',
      accessTier: 'all',
    });

    component.submit();

    expect(createCommunity$).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Comunidade Funcional',
        theme: 'interests',
        joinPolicy: 'approval',
        accessTier: 'all',
      })
    );
    expect(showSuccess).toHaveBeenCalledWith('Comunidade criada.');
    expect(navigate).toHaveBeenCalledWith([
      '/dashboard/comunidades',
      'community-created-1',
    ]);
  });
});
