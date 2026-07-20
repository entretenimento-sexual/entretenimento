// src/app/core/guards/unsaved-changes/unsaved-changes.guard.ts
import { inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { map, take } from 'rxjs/operators';

import {
  ConfirmacaoDialogComponent,
  ConfirmacaoDialogData,
} from 'src/app/shared/components-globais/confirmacao-dialog/confirmacao-dialog.component';

export interface UnsavedChangesAware {
  hasUnsavedChanges(): boolean;
  discardUnsavedChanges?(): void;
}

export const unsavedChangesGuard: CanDeactivateFn<UnsavedChangesAware> = (
  component
) => {
  if (!component?.hasUnsavedChanges?.()) {
    return true;
  }

  const dialog = inject(MatDialog);
  const data: ConfirmacaoDialogData = {
    title: 'Sair sem salvar?',
    message:
      'Existem alterações que ainda não foram salvas. O rascunho local também será descartado.',
    confirmLabel: 'Sair sem salvar',
    cancelLabel: 'Continuar editando',
    tone: 'danger',
  };

  return dialog
    .open(ConfirmacaoDialogComponent, {
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
