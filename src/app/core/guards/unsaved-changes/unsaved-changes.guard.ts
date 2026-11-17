// src/app/core/guards/unsaved-changes/unsaved-changes.guard.ts
import { inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';
import { canLeaveAfterSessionEnded } from '../../services/autentication/auth/auth-session-exit.service';
import { MatDialog } from '@angular/material/dialog';
import { map, take } from 'rxjs/operators';

import {
  ConfirmationDialogComponent,
  ConfirmationDialogData,
} from 'src/app/shared/components-globais/confirmation-dialog/confirmation-dialog.component';

export interface UnsavedChangesAware {
  hasUnsavedChanges(): boolean;
  discardUnsavedChanges?(): void;
  persistUnsavedChanges?(): void;
}

export const unsavedChangesGuard: CanDeactivateFn<UnsavedChangesAware> = (
  component, _route, _state, nextState
) => {
  if (!component?.hasUnsavedChanges?.()) {
    return true;
  }

  if (canLeaveAfterSessionEnded(nextState?.url)) {
    component.persistUnsavedChanges?.();
    return true;
  }

  const dialog = inject(MatDialog);
  const data: ConfirmationDialogData = {
    title: 'Sair sem salvar?',
    message:
      'Existem alterações que ainda não foram salvas. O rascunho local também será descartado.',
    confirmLabel: 'Sair sem salvar',
    cancelLabel: 'Continuar editando',
    tone: 'danger',
  };

  return dialog
    .open(ConfirmationDialogComponent, {
      data,
      width: 'min(92vw, 440px)',
      disableClose: true,
      autoFocus: 'dialog',
      restoreFocus: true,
    })
    .afterClosed()
    .pipe(
      take(1),
      map((confirmed) => {
        if (confirmed === true) {
          component.discardUnsavedChanges?.();
          return true;
        }
        return false;
      })
    );
};
