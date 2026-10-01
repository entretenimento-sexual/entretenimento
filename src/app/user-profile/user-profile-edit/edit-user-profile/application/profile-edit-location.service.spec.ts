import { firstValueFrom } from 'rxjs';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ProfileEditLocationService } from './profile-edit-location.service';

describe('ProfileEditLocationService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('carrega e ordena estados pelo nome', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve({
          json: () =>
            Promise.resolve([
              { id: 2, sigla: 'SP', nome: 'São Paulo' },
              { id: 1, sigla: 'RJ', nome: 'Rio de Janeiro' },
            ]),
        })
      )
    );

    const report = vi.fn();
    const service = new ProfileEditLocationService({ report } as any);

    await expect(firstValueFrom(service.loadEstados$())).resolves.toEqual([
      { id: 1, sigla: 'RJ', nome: 'Rio de Janeiro' },
      { id: 2, sigla: 'SP', nome: 'São Paulo' },
    ]);
    expect(report).not.toHaveBeenCalled();
  });

  it('codifica a UF e ordena municípios', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        json: () =>
          Promise.resolve([
            { id: 2, nome: 'Volta Redonda' },
            { id: 1, nome: 'Rio de Janeiro' },
          ]),
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const service = new ProfileEditLocationService({ report: vi.fn() } as any);

    await expect(
      firstValueFrom(service.loadMunicipios$('RJ'))
    ).resolves.toEqual([
      { id: 1, nome: 'Rio de Janeiro' },
      { id: 2, nome: 'Volta Redonda' },
    ]);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://servicodados.ibge.gov.br/api/v1/localidades/estados/RJ/municipios'
    );
  });

  it('diagnostica falha de estados pelo ApplicationErrorService', async () => {
    const error = new Error('ibge failed');
    vi.stubGlobal('fetch', vi.fn(() => Promise.reject(error)));

    const report = vi.fn();
    const service = new ProfileEditLocationService({ report } as any);

    const values: unknown[] = [];
    await new Promise<void>((resolve) => {
      service.loadEstados$().subscribe({
        next: (value) => values.push(value),
        complete: () => resolve(),
      });
    });

    expect(values).toEqual([]);
    expect(report).toHaveBeenCalledWith(error, {
      feature: 'profile-edit',
      operation: 'ProfileEditLocationService.loadEstados',
      fallbackMessage: 'Erro ao carregar estados.',
      metadata: {
        scope: 'ProfileEditLocationService',
      },
    });
  });
});
