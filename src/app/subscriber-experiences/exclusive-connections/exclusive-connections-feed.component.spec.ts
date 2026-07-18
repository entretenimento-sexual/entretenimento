import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import {
  ExclusiveConnectionsFeedComponent,
  INITIAL_EXCLUSIVE_CONNECTIONS_FEED_STATE,
  reduceExclusiveConnectionsFeedState,
} from './exclusive-connections-feed.component';
import { ExclusiveConnectionsPage } from './exclusive-connections.model';
import { ExclusiveConnectionsRepository } from './exclusive-connections.repository';

function createPage(
  candidateUid = 'candidate-1',
  nextCursor: string | null = null
): ExclusiveConnectionsPage {
  return {
    items: [
      {
        candidateUid,
        nickname: `Pessoa ${candidateUid}`,
        photoURL: null,
        region: { uf: 'RJ', city: 'Niterói' },
        compatibilityScore: 88,
        intentLabel: 'Disponível hoje',
        reasonTags: ['Mesma região'],
      },
    ],
    nextCursor,
    generatedAt: 123,
  };
}

describe('ExclusiveConnectionsFeedComponent', () => {
  const repositoryMock = {
    getPage$: vi.fn(),
  };
  const errorNotifierMock = {
    showError: vi.fn(),
  };
  const globalErrorMock = {
    handleError: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();

    TestBed.configureTestingModule({
      imports: [ExclusiveConnectionsFeedComponent],
      providers: [
        provideRouter([]),
        { provide: ExclusiveConnectionsRepository, useValue: repositoryMock },
        { provide: ErrorNotificationService, useValue: errorNotifierMock },
        { provide: GlobalErrorHandlerService, useValue: globalErrorMock },
      ],
    });
  });

  it('renderiza cards sanitizados recebidos do repository', () => {
    repositoryMock.getPage$.mockReturnValue(of(createPage()));

    const fixture = TestBed.createComponent(ExclusiveConnectionsFeedComponent);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelectorAll(
        '.exclusive-connections-feed__card'
      ).length
    ).toBe(1);
    expect(fixture.nativeElement.textContent).toContain('Pessoa candidate-1');
    expect(fixture.nativeElement.textContent).toContain('88%');
  });

  it('mostra estado vazio sem título visual redundante', () => {
    repositoryMock.getPage$.mockReturnValue(
      of({ items: [], nextCursor: null, generatedAt: 123 })
    );

    const fixture = TestBed.createComponent(ExclusiveConnectionsFeedComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Ainda não há conexões selecionadas.'
    );
    expect(
      fixture.nativeElement.querySelector(
        '.exclusive-connections-feed__card'
      )
    ).toBeNull();
  });

  it('centraliza feedback e diagnóstico quando a callable falha', () => {
    repositoryMock.getPage$.mockReturnValue(
      throwError(() => new Error('permission-denied'))
    );

    const fixture = TestBed.createComponent(ExclusiveConnectionsFeedComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Não foi possível carregar.'
    );
    expect(errorNotifierMock.showError).toHaveBeenCalledTimes(1);
    expect(globalErrorMock.handleError).toHaveBeenCalledTimes(1);
  });

  it('acumula páginas sem duplicar candidatos', () => {
    repositoryMock.getPage$.mockImplementation(
      ({ cursor }: { cursor?: string | null }) =>
        cursor
          ? of(createPage('candidate-2'))
          : of(createPage('candidate-1', 'candidate-1'))
    );

    const fixture = TestBed.createComponent(ExclusiveConnectionsFeedComponent);
    fixture.detectChanges();

    const loadMoreButton = fixture.nativeElement.querySelector(
      '.exclusive-connections-feed__more'
    ) as HTMLButtonElement;
    loadMoreButton.click();
    fixture.detectChanges();

    expect(repositoryMock.getPage$).toHaveBeenCalledTimes(2);
    expect(
      fixture.nativeElement.querySelectorAll(
        '.exclusive-connections-feed__card'
      ).length
    ).toBe(2);
  });

  it('mantém os cards atuais quando uma página adicional falha', () => {
    const loadedState = reduceExclusiveConnectionsFeedState(
      INITIAL_EXCLUSIVE_CONNECTIONS_FEED_STATE,
      {
        type: 'success',
        request: { cursor: null, append: false },
        page: createPage('candidate-1', 'candidate-1'),
      }
    );
    const errorState = reduceExclusiveConnectionsFeedState(loadedState, {
      type: 'error',
      request: { cursor: 'candidate-1', append: true },
    });

    expect(errorState.status).toBe('ready');
    expect(errorState.items).toHaveLength(1);
    expect(errorState.loadingMore).toBe(false);
  });
});
