// src/app/preferences/preferences.routes.spec.ts
import { describe, expect, it } from 'vitest';

import { preferencesUnsavedChangesGuard } from './guards/preferences-unsaved-changes.guard';
import { PREFERENCES_ROUTES } from './preferences.routes';

describe('PREFERENCES_ROUTES / editor da própria conta', () => {
  it('expõe rota canônica sem UID e protege alterações não salvas', () => {
    const route = PREFERENCES_ROUTES.find((item) => item.path === 'editar');

    expect(route).toBeDefined();
    expect(route?.loadComponent).toEqual(expect.any(Function));
    expect(route?.canDeactivate).toContain(preferencesUnsavedChangesGuard);
  });

  it('redireciona links antigos com UID antes de carregar o componente', () => {
    const route = PREFERENCES_ROUTES.find(
      (item) => item.path === 'editar/:uid'
    );

    expect(route).toMatchObject({
      redirectTo: 'editar',
      pathMatch: 'full',
    });
    expect(route?.loadComponent).toBeUndefined();
  });
});
