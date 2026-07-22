// src/app/user-profile/user-profile-edit/edit-user-profile/edit-user-profile.component.ts
import {
  Component,
  HostListener,
  OnDestroy,
  OnInit,
} from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';

import { EMPTY, Observable, Subject, from, of } from 'rxjs';
import {
  catchError,
  debounceTime,
  distinctUntilChanged,
  filter,
  finalize,
  map,
  startWith,
  switchMap,
  take,
  takeUntil,
  tap,
} from 'rxjs/operators';

import { UnsavedChangesAware } from 'src/app/core/guards/unsaved-changes/unsaved-changes.guard';
import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { LocalDraftService } from 'src/app/core/services/drafts/local-draft.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { ValidatorService } from 'src/app/core/services/general/validator.service';
import { StorageService } from 'src/app/core/services/image-handling/storage.service';
import { UsuarioService } from 'src/app/core/services/user-profile/usuario.service';

type IbgeEstado = {
  id: number;
  sigla: string;
  nome: string;
};

type IbgeMunicipio = {
  id: number;
  nome: string;
};

type GenderOption = {
  value: string;
  label: string;
};

type ProfileDraft = Record<string, string>;

const PROFILE_DRAFT_FIELDS = [
  'nickname',
  'estado',
  'municipio',
  'gender',
  'orientation',
  'partner1Orientation',
  'partner2Orientation',
  'descricao',
] as const;

@Component({
  selector: 'app-edit-user-profile',
  templateUrl: './edit-user-profile.component.html',
  styleUrls: ['./edit-user-profile.component.css'],
  standalone: false,
})
export class EditUserProfileComponent
  implements OnInit, OnDestroy, UnsavedChangesAware
{
  public progressValue = 0;
  userData: IUserDados = {} as IUserDados;
  editForm: FormGroup;

  uid = '';
  estados: IbgeEstado[] = [];
  municipios: IbgeMunicipio[] = [];

  isUploading = false;
  isSaving = false;

  private readonly destroy$ = new Subject<void>();
  private draftReady = false;
  private draftKey = '';

  readonly genderOptions: GenderOption[] = [
    { value: 'homem', label: 'Homem' },
    { value: 'mulher', label: 'Mulher' },
    { value: 'casal-ele-ele', label: 'Casal (Ele/Ele)' },
    { value: 'casal-ele-ela', label: 'Casal (Ele/Ela)' },
    { value: 'casal-ela-ela', label: 'Casal (Ela/Ela)' },
    { value: 'travesti', label: 'Travesti' },
    { value: 'transexual', label: 'Transexual' },
    { value: 'crossdressers', label: 'Crossdressers' },
  ];

  constructor(
    private readonly firestoreUserQuery: FirestoreUserQueryService,
    private readonly usuarioService: UsuarioService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly formBuilder: FormBuilder,
    private readonly storageService: StorageService,
    private readonly localDraft: LocalDraftService,
    private readonly notify: ErrorNotificationService,
    private readonly globalError: GlobalErrorHandlerService
  ) {
    this.editForm = this.formBuilder.group({
      nickname: ['', [Validators.minLength(3)]],
      estado: [''],
      municipio: [{ value: '', disabled: true }],
      gender: [''],
      orientation: [''],
      partner1Orientation: [''],
      partner2Orientation: [''],
      descricao: ['', [Validators.maxLength(2000)]],
    });
  }

  isCouple(): boolean {
    const gender = String(
      this.editForm.get('gender')?.value ?? this.userData.gender ?? ''
    );

    return [
      'casal-ele-ele',
      'casal-ele-ela',
      'casal-ela-ela',
    ].includes(gender);
  }

  ngOnInit(): void {
    this.uid = String(
      this.route.snapshot.paramMap.get('id') ??
        this.route.snapshot.paramMap.get('uid') ??
        ''
    ).trim();

    if (!this.uid) {
      this.notify.showError(
        'Não foi possível identificar o usuário para edição.'
      );
      this.router.navigate(['/perfil']).catch(() => undefined);
      return;
    }

    this.draftKey = `profile-edit:${this.uid}`;
    this.observeDraftChanges();

    this.firestoreUserQuery
      .getUser(this.uid)
      .pipe(
        take(1),
        tap((user) => {
          if (!user) throw new Error('Usuário não encontrado.');
          this.userData = user;
        }),
        switchMap((user) =>
          this.loadEstados$().pipe(
            tap((estados) => (this.estados = estados)),
            switchMap(() =>
              user?.estado ? this.loadMunicipios$(user.estado) : of([])
            ),
            tap((municipios) => {
              this.municipios = municipios;
              this.syncMunicipioControlState(municipios);
            }),
            tap(() => this.patchFormFromUser(this.userData))
          )
        ),
        catchError((error) =>
          this.handleError$(
            error,
            'init',
            'Falha ao carregar seus dados para edição.'
          )
        ),
        finalize(() => this.initializeDraftState()),
        takeUntil(this.destroy$)
      )
      .subscribe();

    this.editForm
      .get('gender')!
      .valueChanges.pipe(
        startWith(this.editForm.get('gender')!.value),
        map((value) => String(value ?? '')),
        distinctUntilChanged(),
        tap((gender) => this.syncOrientationControls(gender)),
        takeUntil(this.destroy$)
      )
      .subscribe();

    this.editForm
      .get('estado')!
      .valueChanges.pipe(
        map((value) => String(value ?? '').trim()),
        distinctUntilChanged(),
        switchMap((sigla) =>
          sigla ? this.loadMunicipios$(sigla) : of([])
        ),
        tap((municipios) => {
          this.municipios = municipios;
          this.syncMunicipioControlState(municipios);

          const selected = String(
            this.editForm.get('municipio')?.value ?? ''
          );

          if (
            selected &&
            municipios.some((municipio) => municipio.nome === selected)
          ) {
            return;
          }

          this.editForm.patchValue(
            { municipio: municipios[0]?.nome ?? '' },
            { emitEvent: false }
          );
        }),
        catchError((error) =>
          this.handleError$(
            error,
            'estadoChange',
            'Falha ao carregar municípios.'
          )
        ),
        takeUntil(this.destroy$)
      )
      .subscribe();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.hasUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = '';
  }

  hasUnsavedChanges(): boolean {
    return this.draftReady && this.editForm.dirty && !this.isSaving;
  }

  discardUnsavedChanges(): void {
    this.localDraft.remove(this.draftKey);
    this.editForm.markAsPristine();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.uploadFile(file);
  }

  uploadFile(file: File): void {
    if (!this.uid || this.isUploading) return;

    this.progressValue = 0;
    this.isUploading = true;

    this.storageService
      .uploadProfileAvatar(file, this.uid, (progress: number) => {
        this.progressValue = progress;
      })
      .pipe(
        tap((imageUrl: string) => {
          this.userData = { ...this.userData, photoURL: imageUrl };
        }),
        catchError((error) =>
          this.handleError$(
            error,
            'uploadProfileAvatar',
            'Erro durante o upload da foto.'
          )
        ),
        finalize(() => (this.isUploading = false)),
        takeUntil(this.destroy$)
      )
      .subscribe();
  }

  onEstadoChange(_estadoSigla: string): void {
    // Mantido por compatibilidade com templates antigos.
  }

  onSubmit(): void {
    if (this.isSaving) return;

    if (this.isUploading) {
      this.notify.showError(
        'Aguarde o upload da foto terminar antes de salvar.'
      );
      return;
    }

    if (this.editForm.invalid) {
      this.editForm.markAllAsTouched();
      this.notify.showError(
        'Revise os campos do formulário antes de salvar.'
      );
      return;
    }

    this.isSaving = true;
    const value = this.editForm.getRawValue();

    const profilePatch: Partial<IUserDados> = {
      nickname: String(value.nickname ?? '').trim(),
      estado: String(value.estado ?? '').trim(),
      municipio: String(value.municipio ?? '').trim(),
      gender: String(value.gender ?? '').trim(),
      descricao: String(value.descricao ?? ''),
      orientation: this.isCouple()
        ? ''
        : String(value.orientation ?? '').trim(),
      partner1Orientation: this.isCouple()
        ? String(value.partner1Orientation ?? '').trim()
        : undefined,
      partner2Orientation: this.isCouple()
        ? String(value.partner2Orientation ?? '').trim()
        : undefined,
      photoURL: this.userData.photoURL ?? null,
    };

    this.usuarioService
      .atualizarUsuario(this.uid, profilePatch)
      .pipe(
        finalize(() => (this.isSaving = false)),
        catchError((error) =>
          this.handleError$(
            error,
            'onSubmit',
            'Não foi possível salvar agora.'
          )
        ),
        takeUntil(this.destroy$)
      )
      .subscribe({
        next: () => {
          this.localDraft.remove(this.draftKey);
          this.editForm.markAsPristine();
          this.notify.showSuccess('Perfil atualizado com sucesso.');
          this.router
            .navigate(['/perfil', this.uid])
            .catch(() => undefined);
        },
      });
  }

  private initializeDraftState(): void {
    if (this.draftReady || !this.draftKey) return;

    this.editForm.markAsPristine();
    const draft = this.localDraft.load<ProfileDraft>(this.draftKey);
    this.draftReady = true;

    if (!draft) return;

    const patch: ProfileDraft = {};
    PROFILE_DRAFT_FIELDS.forEach((field) => {
      if (typeof draft[field] === 'string') {
        patch[field] = draft[field];
      }
    });

    this.editForm.patchValue(patch, { emitEvent: true });
    this.editForm.markAsDirty();
  }

  private observeDraftChanges(): void {
    this.editForm.valueChanges
      .pipe(
        debounceTime(500),
        filter(
          () =>
            this.draftReady &&
            this.editForm.dirty &&
            !this.isSaving
        ),
        tap(() => {
          const rawValue = this.editForm.getRawValue();
          const draft: ProfileDraft = {};

          PROFILE_DRAFT_FIELDS.forEach((field) => {
            draft[field] = String(rawValue[field] ?? '');
          });

          this.localDraft.save(this.draftKey, draft);
        }),
        takeUntil(this.destroy$)
      )
      .subscribe();
  }

  private patchFormFromUser(user: IUserDados): void {
    this.editForm.patchValue(
      {
        nickname: user.nickname ?? '',
        estado: user.estado ?? '',
        municipio: user.municipio ?? '',
        gender: user.gender ?? '',
        orientation: user.orientation ?? '',
        partner1Orientation: user.partner1Orientation ?? '',
        partner2Orientation: user.partner2Orientation ?? '',
        descricao: user.descricao ?? '',
      },
      { emitEvent: true }
    );
  }

  private syncOrientationControls(gender: string): void {
    const isCouple = [
      'casal-ele-ele',
      'casal-ele-ela',
      'casal-ela-ela',
    ].includes(gender);

    const orientation = this.editForm.get('orientation')!;
    const partner1 = this.editForm.get('partner1Orientation')!;
    const partner2 = this.editForm.get('partner2Orientation')!;

    if (isCouple) {
      orientation.disable({ emitEvent: false });
      orientation.setValue('', { emitEvent: false });
      partner1.enable({ emitEvent: false });
      partner2.enable({ emitEvent: false });
    } else {
      orientation.enable({ emitEvent: false });
      partner1.disable({ emitEvent: false });
      partner2.disable({ emitEvent: false });
      partner1.setValue('', { emitEvent: false });
      partner2.setValue('', { emitEvent: false });
    }

    partner1.updateValueAndValidity({ emitEvent: false });
    partner2.updateValueAndValidity({ emitEvent: false });
    orientation.updateValueAndValidity({ emitEvent: false });
  }

  private loadEstados$(): Observable<IbgeEstado[]> {
    return from(
      fetch(
        'https://servicodados.ibge.gov.br/api/v1/localidades/estados'
      ).then((response) => response.json())
    ).pipe(
      map((estados: IbgeEstado[]) =>
        (estados ?? []).sort((first, second) =>
          first.nome.localeCompare(second.nome)
        )
      ),
      catchError((error) =>
        this.handleError$(
          error,
          'loadEstados',
          'Erro ao carregar estados.'
        ).pipe(map(() => []))
      )
    );
  }

  private loadMunicipios$(
    estadoSigla: string
  ): Observable<IbgeMunicipio[]> {
    const sigla = String(estadoSigla ?? '').trim();
    if (!sigla) return of([]);

    return from(
      fetch(
        `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${sigla}/municipios`
      ).then((response) => response.json())
    ).pipe(
      map((municipios: IbgeMunicipio[]) =>
        (municipios ?? []).sort((first, second) =>
          first.nome.localeCompare(second.nome)
        )
      ),
      catchError((error) =>
        this.handleError$(
          error,
          'loadMunicipios',
          'Erro ao carregar municípios.'
        ).pipe(map(() => []))
      )
    );
  }

  private handleError$(
    error: unknown,
    context: string,
    userMessage: string
  ): Observable<never> {
    const normalized =
      error instanceof Error
        ? error
        : new Error(String(error ?? 'unknown'));
    const contextual = normalized as Error & {
      context?: unknown;
      silent?: boolean;
    };

    contextual.context = `EditUserProfileComponent.${context}`;
    contextual.silent = true;

    try {
      this.globalError.handleError(contextual);
    } catch {
      // Falha secundária de telemetria não bloqueia a interface.
    }

    this.notify.showError(userMessage);
    return EMPTY;
  }

  private syncMunicipioControlState(
    municipios: IbgeMunicipio[]
  ): void {
    const municipioControl = this.editForm.get('municipio');
    if (!municipioControl) return;

    if (municipios.length > 0) {
      municipioControl.enable({ emitEvent: false });
      return;
    }

    municipioControl.disable({ emitEvent: false });
    municipioControl.patchValue('', { emitEvent: false });
  }
}
