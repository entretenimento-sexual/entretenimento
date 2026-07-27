// src/app/preferences/guards/preferences-unsaved-changes.guard.spec.ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  preferencesUnsavedChangesGuard,
  type PreferencesUnsavedChangesAware,
} from './preferences-unsaved-changes.guard';

describe('preferencesUnsavedChangesGuard', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('permite sair quando não existem alterações', () => {
    const component: PreferencesUnsavedChangesAware = {
      hasUnsavedChanges: () => false,
    };
    const confirmSpy = vi.spyOn(window, 'confirm');

    const result = preferencesUnsavedChangesGuard(
      component,
      {} as never,
      {} as never,
      {} as never
    );

    expect(result).toBe(true);
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it('permite sair quando o usuário confirma o descarte', () => {
    const component: PreferencesUnsavedChangesAware = {
      hasUnsavedChanges: () => true,
    };
    vi.spyOn(window, 'confirm').mockReturnValue(true);

    const result = preferencesUnsavedChangesGuard(
      component,
      {} as never,
      {} as never,
      {} as never
    );

    expect(result).toBe(true);
  });

  it('mantém o usuário no editor quando ele cancela', () => {
    const component: PreferencesUnsavedChangesAware = {
      hasUnsavedChanges: () => true,
    };
    vi.spyOn(window, 'confirm').mockReturnValue(false);

    const result = preferencesUnsavedChangesGuard(
      component,
      {} as never,
      {} as never,
      {} as never
    );

    expect(result).toBe(false);
  });
});
