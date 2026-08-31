// src/app/core/services/error-handler/application-error-presentation.model.ts
// -----------------------------------------------------------------------------
// APPLICATION ERROR PRESENTATION MODEL
// -----------------------------------------------------------------------------
// Contrato canônico que separa a interpretação do erro da superfície visual.
// Domínios podem declarar intenção de UX sem conhecer MatSnackBar/MatDialog.
// -----------------------------------------------------------------------------

export type ApplicationErrorSurface =
  | 'snackbar'
  | 'modal'
  | 'inline'
  | 'page'
  | 'none';

export type ApplicationErrorSeverity = 'error' | 'warning' | 'info';

export interface ApplicationErrorAction {
  readonly label: string;
  /** Rota interna Angular. URLs externas não pertencem a este contrato. */
  readonly route?: string;
}

export interface ApplicationErrorPresentation {
  readonly surface: ApplicationErrorSurface;
  readonly severity: ApplicationErrorSeverity;
  readonly title?: string;
  readonly detail?: string;
  readonly primaryAction?: ApplicationErrorAction;
  readonly dismissLabel?: string;
}

export type ApplicationErrorPresentationMap = Readonly<
  Record<string, ApplicationErrorPresentation>
>;

export const DEFAULT_APPLICATION_ERROR_PRESENTATION:
  ApplicationErrorPresentation = Object.freeze({
    surface: 'snackbar',
    severity: 'error',
  });
