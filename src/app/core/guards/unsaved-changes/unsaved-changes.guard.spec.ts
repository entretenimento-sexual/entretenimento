import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom, of } from 'rxjs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  UnsavedChangesAware,
  unsavedChangesGuard,
} from './unsaved-changes.guard';

describe('unsavedChangesGuard', () => {
  const afterClosed = vi.fn();
  const open = vi.fn(() => ({ afterClosed }));

  beforeEach(() => {
    afterClosed.mockReset();
    open.mockClear();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: MatDialog,
          useValue: { open },
        },
      ],
    });
  });

  it('permite sair quando não há alterações', () => {
    const component: UnsavedChangesAware = {
      hasUnsavedChanges: () => false,
    };

    const result = TestBed.runInInjectionContext(() =>
      unsavedChangesGuard(component, {} as never, {} as never, {} as never)
    );

    expect(result).toBe(true);
    expect(open).not.toHaveBeenCalled();
  });

  it('mantém o usuário na tela quando ele cancela', async () => {
    afterClosed.mockReturnValue(of(false));
    const discard = vi.fn();
    const component: UnsavedChangesAware = {
      hasUnsavedChanges: () => true,
      discardUnsavedChanges: discard,
    };

    const result = TestBed.runInInjectionContext(() =>
      unsavedChangesGuard(component, {} as never, {} as never, {} as never)
    );

    expect(await firstValueFrom(result as ReturnType<typeof of>)).toBe(false);
    expect(discard).not.toHaveBeenCalled();
  });

  it('descarta o rascunho somente após confirmação', async () => {
    afterClosed.mockReturnValue(of(true));
    const discard = vi.fn();
    const component: UnsavedChangesAware = {
      hasUnsavedChanges: () => true,
      discardUnsavedChanges: discard,
    };

    const result = TestBed.runInInjectionContext(() =>
      unsavedChangesGuard(component, {} as never, {} as never, {} as never)
    );

    expect(await firstValueFrom(result as ReturnType<typeof of>)).toBe(true);
    expect(discard).toHaveBeenCalledTimes(1);
  });
});
