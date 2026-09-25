import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';
import { BehaviorSubject, of, Subject, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { CommunityMemberSearchPage } from '../data-access/community-member-search.model';
import { CommunityMemberSearchRepository } from '../data-access/community-member-search.repository';
import { normalizeCommunityMemberRosterPage, CommunityMemberRosterPage } from '../data-access/community-member-roster.model';
import { CommunityMemberRosterRepository } from '../data-access/community-member-roster.repository';
import { CommunityMembersPageComponent } from './community-members-page.component';

@Component({ standalone: true, template: '' })
class ProfileTargetComponent {}

const firstId = 'profile-00000000-0000-4000-8000-000000000001';
const secondId = 'profile-00000000-0000-4000-8000-000000000002';

function searchPage(
  ids = [firstId],
  nextCursor: string | null = null
): CommunityMemberSearchPage {
  return {
    items: ids.map((id, index) => ({
      memberKey: id,
      identity: { profileId: id, nickname: index ? 'Bia' : 'Ana', avatarUrl: null },
      role: 'member',
    })),
    nextCursor,
    memberCount: 2,
    generatedAt: 123,
  };
}

function page(ids = [firstId], nextCursor: string | null = firstId): CommunityMemberRosterPage {
  return normalizeCommunityMemberRosterPage({
    items: ids.map((id, index) => ({
      memberKey: id,
      identity: { profileId: id, nickname: index ? 'Bia' : 'Ana', avatarUrl: null },
      role: 'member',
    })),
    nextCursor, memberCount: 2, generatedAt: 123,
  })!;
}

describe('CommunityMembersPageComponent / fluxo completo', () => {
  const getPage$ = vi.fn();
  const searchPage$ = vi.fn();
  const handleError = vi.fn();
  const showApplicationError = vi.fn();
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  beforeEach(() => {
    vi.clearAllMocks();
    getPage$.mockReset();
    searchPage$.mockReset();
    params = new BehaviorSubject(convertToParamMap({ communityId: 'community-1' }));
    getPage$.mockReturnValue(of(page()));
    searchPage$.mockReturnValue(of(searchPage()));
    TestBed.configureTestingModule({
      imports: [CommunityMembersPageComponent],
      providers: [
        provideRouter([{ path: 'perfil/:uid', component: ProfileTargetComponent }]),
        { provide: ActivatedRoute, useValue: { paramMap: params } },
        { provide: CommunityMemberRosterRepository, useValue: { getPage$ } },
        { provide: CommunityMemberSearchRepository, useValue: { searchPage$ } },
        { provide: GlobalErrorHandlerService, useValue: { handleError } },
        { provide: ErrorNotificationService, useValue: { showApplicationError } },
      ],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  function create() {
    const fixture = TestBed.createComponent(CommunityMembersPageComponent);
    fixture.componentRef.setInput('embedded', true);
    fixture.detectChanges();
    return fixture;
  }

  it('mostra carregamento e abre o perfil pelo identificador público', async () => {
    const response = new Subject<CommunityMemberRosterPage>();
    getPage$.mockReturnValue(response);
    const fixture = create();
    expect(fixture.nativeElement.textContent).toContain('Carregando integrantes');
    response.next(page());
    response.complete();
    fixture.detectChanges();
    const link = fixture.nativeElement.querySelector('.community-members__profile') as HTMLAnchorElement;
    expect(link.getAttribute('aria-label')).toBe('Ver perfil de Ana');
    expect(link.getAttribute('href')).toBe('/perfil/' + firstId);
    link.click();
    await fixture.whenStable();
    expect(TestBed.inject(Router).url).toBe('/perfil/' + firstId);
  });


  it('busca integrantes de forma reativa sem filtrar a lista localmente', async () => {
    vi.useFakeTimers();
    try {
      const fixture = create();
      fixture.componentInstance.searchControl.setValue('Ana');
      await vi.advanceTimersByTimeAsync(301);
      fixture.detectChanges();

      expect(searchPage$).toHaveBeenCalledWith({
        communityId: 'community-1',
        query: 'Ana',
        cursor: null,
        limit: 20,
      });
      expect(fixture.nativeElement.textContent).toContain('Ana');
      expect(
        fixture.nativeElement.querySelector(
          '[aria-label="Resultados da busca por Ana"]'
        )
      ).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('pagina sem duplicar integrantes nem repetir solicitações simultâneas', () => {
    const fixture = create();
    const response = new Subject<CommunityMemberRosterPage>();
    getPage$.mockReturnValue(response);
    fixture.componentInstance.loadMore(firstId);
    fixture.componentInstance.loadMore(firstId);
    fixture.detectChanges();
    expect(getPage$).toHaveBeenCalledTimes(2);
    expect(fixture.nativeElement.querySelector('.community-members__more button').disabled).toBe(true);
    response.next(page([firstId, secondId], null));
    response.complete();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.community-members__item')).toHaveLength(2);
    expect(fixture.nativeElement.querySelector('.community-members__more')).toBeNull();
  });

  it('preserva a lista em falha transitória e permite tentar a página novamente', () => {
    const fixture = create();
    getPage$.mockReturnValueOnce(throwError(() => ({ code: 'functions/unavailable' })));
    fixture.componentInstance.loadMore(firstId);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.community-members__item')).toHaveLength(1);
    expect(fixture.nativeElement.textContent).toContain('temporariamente indisponível');
    expect(handleError).toHaveBeenCalledTimes(1);
    expect(showApplicationError).toHaveBeenCalledWith(
      expect.any(String), expect.objectContaining({ surface: 'inline' })
    );
    getPage$.mockReturnValue(of(page([secondId], null)));
    fixture.nativeElement.querySelector('.community-members__more button').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.community-members__item')).toHaveLength(2);
    expect(fixture.nativeElement.querySelector('.community-members__more-error')).toBeNull();
  });

  it('reinicia a consulta quando o cursor perde a validade', () => {
    const fixture = create();
    getPage$.mockReturnValueOnce(throwError(() => ({
      code: 'functions/invalid-argument',
      details: { reason: 'invalid_community_member_roster_cursor' },
    })));
    fixture.componentInstance.loadMore(firstId);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('A paginação da lista perdeu a validade');
    const button = fixture.nativeElement.querySelector('.community-members__more button');
    expect(button.textContent).toContain('Atualizar lista');
    getPage$.mockReturnValue(of(page([secondId], null)));
    button.click();
    fixture.detectChanges();
    expect(getPage$).toHaveBeenLastCalledWith({ communityId: 'community-1', cursor: null, limit: 20 });
    expect(fixture.nativeElement.querySelectorAll('.community-members__item')).toHaveLength(1);
  });

  it.each(['permission-denied', 'unauthenticated', 'not-found', 'failed-precondition'])(
    'limpa os integrantes ao receber %s durante a paginação',
    (code) => {
      const fixture = create();
      getPage$.mockReturnValueOnce(throwError(() => ({ code: 'functions/' + code })));
      fixture.componentInstance.loadMore(firstId);
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.community-members__list')).toBeNull();
      expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    }
  );

  it('mostra o motivo seguro do erro inicial e mantém retry reativo', () => {
    getPage$.mockReturnValueOnce(throwError(() => ({
      code: 'functions/failed-precondition',
      details: { reason: 'email_verification_required' },
    })));
    const fixture = create();
    expect(fixture.nativeElement.textContent).toContain('Verifique seu e-mail');
    fixture.nativeElement.querySelector('.community-members__state button').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('.community-members__item')).toHaveLength(1);
  });

  it('exibe estado vazio sem botão de paginação', () => {
    getPage$.mockReturnValue(of(page([], null)));
    const fixture = create();
    expect(fixture.nativeElement.textContent).toContain('Nenhum integrante disponível');
    expect(fixture.nativeElement.querySelector('.community-members__more')).toBeNull();
  });

  it('descarta resposta antiga ao trocar de Comunidade e cancela ao destruir', () => {
    const oldResponse = new Subject<CommunityMemberRosterPage>();
    const newResponse = new Subject<CommunityMemberRosterPage>();
    getPage$.mockReturnValueOnce(oldResponse).mockReturnValueOnce(newResponse);
    const fixture = create();
    params.next(convertToParamMap({ communityId: 'community-2' }));
    expect(oldResponse.observed).toBe(false);
    expect(getPage$).toHaveBeenLastCalledWith({ communityId: 'community-2', cursor: null, limit: 20 });
    newResponse.next(page([secondId], null));
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.community-members__profile').getAttribute('href'))
      .toBe('/perfil/' + secondId);
    fixture.destroy();
    expect(newResponse.observed).toBe(false);
  });
});
