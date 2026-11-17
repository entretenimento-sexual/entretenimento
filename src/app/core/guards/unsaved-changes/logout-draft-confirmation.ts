import { MatDialog } from '@angular/material/dialog';
import { ChildrenOutletContexts, PRIMARY_OUTLET } from '@angular/router';
import { Observable, of } from 'rxjs';
import { defaultIfEmpty, finalize, map, take, takeUntil } from 'rxjs/operators';

import {
  ConfirmationDialogComponent,
  type ConfirmationDialogData,
} from 'src/app/shared/components-globais/confirmation-dialog/confirmation-dialog.component';
import type { UnsavedChangesAware } from './unsaved-changes.guard';

/** null indica que o usuário preferiu continuar editando. */
export function confirmLogoutWithDraft$(
  contexts: ChildrenOutletContexts,
  dialog: MatDialog,
  cancelled$: Observable<unknown>
): Observable<(() => void) | null> {
  const drafts: UnsavedChangesAware[] = [];
  let context = contexts.getContext(PRIMARY_OUTLET);

  while (context?.outlet?.isActivated) {
    const page = context.outlet.component as Partial<UnsavedChangesAware> | null;
    if (page?.hasUnsavedChanges?.()) drafts.push(page as UnsavedChangesAware);
    context = context.children.getContext(PRIMARY_OUTLET);
  }

  if (!drafts.length) return of(() => {});

  const data: ConfirmationDialogData = {
    title: 'Sair da conta sem salvar?',
    message: 'As alterações que ainda não foram salvas serão descartadas ao sair.',
    confirmLabel: 'Sair sem salvar',
    cancelLabel: 'Continuar editando',
    tone: 'danger',
  };
  const ref = dialog.open(ConfirmationDialogComponent, {
    data,
    width: 'min(92vw, 440px)',
    disableClose: true,
    autoFocus: 'dialog',
    restoreFocus: true,
  });
  return ref.afterClosed().pipe(
    take(1),
    takeUntil(cancelled$),
    defaultIfEmpty(false),
    finalize(() => ref.close()),
    map((confirmed) => confirmed === true
      ? () => drafts.forEach((draft) => draft.discardUnsavedChanges?.())
      : null)
  );
}
