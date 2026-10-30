import { describe, expect, it } from 'vitest';

import { visitedProfileReturnRoute } from './visited-profile-return-route';

describe('retorno ao perfil a partir de galerias públicas', () => {
  it('abre o perfil visitado ao retornar de fotos ou vídeos de terceiros', () => {
    expect(visitedProfileReturnRoute('owner-1', 'viewer-2')).toEqual([
      '/outro-perfil', 'owner-1',
    ]);
  });

  it('volta à rota própria para mídias do usuário autenticado', () => {
    expect(visitedProfileReturnRoute('owner-1', 'owner-1')).toEqual(['/perfil']);
  });

  it('não confunde visitante ausente com proprietário', () => {
    expect(visitedProfileReturnRoute('owner-1', null)).toEqual([
      '/outro-perfil', 'owner-1',
    ]);
  });

  it('não cria link para perfil inexistente', () => {
    expect(visitedProfileReturnRoute('', 'viewer-2')).toEqual([
      '/dashboard/explorar',
    ]);
  });
});
