// src/app/user-profile/user-profile-edit/edit-user-profile/edit-user-profile.component.ts
import { Component, OnDestroy, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';

import { Subject, EMPTY, from, of } from 'rxjs';
import { catchError, distinctUntilChanged, finalize, map, startWith, switchMap, take, takeUntil, tap } from 'rxjs/operators';

import { IUserDados } from 'src/app/core/interfaces/iuser-dados';
import { UsuarioService } from 'src/app/core/services/user-profile/usuario.service';
import { FirestoreUserQueryService } from 'src/app/core/services/data-handling/firestore-user-query.service';
import { StorageService } from 'src/app/core/services/image-handling/storage.service';

import { ValidatorService } from 'src/app/core/services/general/validator.service';
import { UserSocialLinksService } from 'src/app/core/services/user-profile/user-social-links.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { IUserSocialLinks } from 'src/app/core/interfaces/interfaces-user-dados/iuser-social-links';
import { environment } from 'src/environments/environment';

@Component({
  selector: 'app-edit-user-profile',
  templateUrl: './edit-user-profile.component.html',
  styleUrls: ['./edit-user-profile.component.css'],
  standalone: false
})
export class EditUserProfileComponent implements OnInit, OnDestroy {
  public progressValue = 0;

  userData: IUserDados = {} as IUserDados;
  editForm: FormGroup;

  uid = '';
  estados: any[] = [];
  municipios: any[] = [];

  isUploading = false;
  isSaving = false;

  private readonly destroy$ = new Subject<void>();

  genderOptions = [
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
    private readonly userSocialLinks: UserSocialLinksService,
    private readonly route: ActivatedRoute,
    private readonly router: Router,
    private readonly formBuilder: FormBuilder,
    private readonly storageService: StorageService,
    private readonly notify: ErrorNotificationService,
    private readonly globalError: GlobalErrorHandlerService,
  ) {
    this.editForm = this.formBuilder.group({
      nickname: ['', [Validators.minLength(3)]],
      estado: [''],
      municipio: [''],
      gender: [''],
      orientation: [''],
      partner1Orientation: [''],
      partner2Orientation: [''],
      descricao: ['', [Validators.maxLength(2000)]],

      // redes
      facebook: ['', [ValidatorService.facebookValidator()]],
      instagram: ['', [ValidatorService.instagramValidator()]],

      // ✅ buupe removido
      hotvips: [''],
      sexlog: [''],
      d4swing: [''],

      privacy: [''],
      onlyfans: [''],
      fansly: [''],
      linktree: [''],
      twitter: [''],
      tiktok: [''],
      youtube: [''],
      linkedin: [''],
      snapchat: [''],
    });
  }

  // Mantém nomenclatura
  isCouple(): boolean {
    const g = (this.editForm.get('gender')?.value ?? this.userData.gender ?? '').toString();
    return ['casal-ele-ele', 'casal-ele-ela', 'casal-ela-ela'].includes(g);
  }

  ngOnInit(): void {
    // Robustez com id/uid (até você padronizar de vez)
    this.uid = (this.route.snapshot.paramMap.get('id') ?? this.route.snapshot.paramMap.get('uid') ?? '').trim();
    if (!this.uid) {
      this.notify.showError('Não foi possível identificar o usuário para edição.');
      this.router.navigate(['/perfil']);
      return;
    }

    // 1) carregar user (one-shot para não “resetar” o form enquanto edita)
    this.firestoreUserQuery.getUser(this.uid).pipe(
      take(1),
      tap(user => {
        if (!user) throw new Error('Usuário não encontrado.');
        this.userData = user;
      }),
      switchMap(user => {
        // 2) estados → municípios → patch do form
        return this.loadEstados$().pipe(
          tap(est => (this.estados = est)),
          switchMap(() => user?.estado ? this.loadMunicipios$(user.estado) : of([])),
          tap(muns => (this.municipios = muns)),
          tap(() => this.patchFormFromUser(this.userData)),
          // 3) social links canônico (profileData/socialLinks)
          switchMap(() => this.userSocialLinks.getSocialLinks(this.uid, { allowAnonymousRead: false }).pipe(take(1))),
          tap(links => this.patchFormFromSocialLinks(links)),
        );
      }),
      catchError(err => this.handleError$(err, 'init', 'Falha ao carregar seus dados para edição.')),
      takeUntil(this.destroy$),
    ).subscribe();

    // 4) reagir a mudança de gender (habilitar/desabilitar campos)
    this.editForm.get('gender')!.valueChanges.pipe(
      startWith(this.editForm.get('gender')!.value),
      map(v => (v ?? '').toString()),
      distinctUntilChanged(),
      tap(g => this.syncOrientationControls(g)),
      takeUntil(this.destroy$),
    ).subscribe();

    // 5) reagir a mudança de estado (carregar municípios)
    this.editForm.get('estado')!.valueChanges.pipe(
      map(v => (v ?? '').toString().trim()),
      distinctUntilChanged(),
      switchMap(sigla => (sigla ? this.loadMunicipios$(sigla) : of([]))),
      tap(muns => {
        this.municipios = muns;
        const selected = (this.editForm.get('municipio')?.value ?? '').toString();
        if (selected && muns.some(m => m.nome === selected)) return;
        this.editForm.patchValue({ municipio: muns[0]?.nome ?? '' }, { emitEvent: false });
      }),
      catchError(err => this.handleError$(err, 'estadoChange', 'Falha ao carregar municípios.')),
      takeUntil(this.destroy$),
    ).subscribe();
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Mantém nome
  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) this.uploadFile(file);
  }

  // Mantém nome
  uploadFile(file: File): void {
    if (!this.uid) return;

    this.progressValue = 0;
    this.isUploading = true;

    this.storageService.uploadProfileAvatar(file, this.uid, (progress: number) => {
      this.progressValue = progress;
      if (environment.enableDebugTools) console.debug('[EditUserProfile] upload progress', progress);
    }).pipe(
      tap((imageUrl: string) => {
        this.userData = { ...this.userData, photoURL: imageUrl };
      }),
      catchError(err => this.handleError$(err, 'uploadProfileAvatar', 'Erro durante o upload da foto.')),
      finalize(() => (this.isUploading = false)),
      takeUntil(this.destroy$),
    ).subscribe();
  }

  // Mantém nome (agora sync; o valueChanges já chama isso)
  onEstadoChange(_estadoSigla: string): void {
    // mantido por compat com template antigo (se quiser remover o (change), pode)
  }

  // Mantém nome
  onSubmit(): void {
    if (this.isUploading) {
      this.notify.showError('Aguarde o upload da foto terminar antes de salvar.');
      return;
    }

    if (this.editForm.invalid) {
      this.editForm.markAllAsTouched();
      this.notify.showError('Revise os campos do formulário antes de salvar.');
      return;
    }

    this.isSaving = true;

    const v = this.editForm.value;

    // ✅ patch “whitelist” para users/{uid}
    const profilePatch: Partial<IUserDados> = {
      nickname: (v.nickname ?? '').toString().trim(),
      estado: (v.estado ?? '').toString().trim(),
      municipio: (v.municipio ?? '').toString().trim(),
      gender: (v.gender ?? '').toString().trim(),
      descricao: (v.descricao ?? '').toString(),

      // casal vs não casal
      orientation: this.isCouple() ? '' : (v.orientation ?? '').toString().trim(),
      partner1Orientation: this.isCouple() ? (v.partner1Orientation ?? '').toString().trim() : undefined,
      partner2Orientation: this.isCouple() ? (v.partner2Orientation ?? '').toString().trim() : undefined,

      // avatar atualizado via upload
      photoURL: this.userData.photoURL ?? null,
    };

    // ✅ links sociais: doc canônico /users/{uid}/profileData/socialLinks
    const socialLinks: IUserSocialLinks = this.compactSocialLinks({
      facebook: v.facebook,
      instagram: v.instagram,
      hotvips: v.hotvips,
      sexlog: v.sexlog,
      d4swing: v.d4swing,
      privacy: v.privacy,
      onlyfans: v.onlyfans,
      fansly: v.fansly,
      linktree: v.linktree,
      twitter: v.twitter,
      tiktok: v.tiktok,
      youtube: v.youtube,
      linkedin: v.linkedin,
      snapchat: v.snapchat,
    });

    this.usuarioService.atualizarUsuario(this.uid, profilePatch).pipe(
      switchMap(() => this.userSocialLinks.saveSocialLinks(this.uid, socialLinks, { notifyOnError: true })),
      finalize(() => (this.isSaving = false)),
      catchError(err => this.handleError$(err, 'onSubmit', 'Não foi possível salvar agora.')),
      takeUntil(this.destroy$),
    ).subscribe({
      next: () => {
        this.notify.showSuccess('Perfil atualizado com sucesso.');
        this.router.navigate(['/perfil', this.uid]);
      }
    });
  }

  // -------------------------
  // Internals
  // -------------------------

  private patchFormFromUser(user: IUserDados): void {
    // Importante: set userData primeiro (para evitar isCouple falso)
    this.editForm.patchValue({
      nickname: user.nickname ?? '',
      estado: user.estado ?? '',
      municipio: user.municipio ?? '',
      gender: user.gender ?? '',
      orientation: user.orientation ?? '',
      partner1Orientation: user.partner1Orientation ?? '',
      partner2Orientation: user.partner2Orientation ?? '',
      descricao: user.descricao ?? '',
    }, { emitEvent: true }); // deixa os valueChanges ajustarem controles
  }

  private patchFormFromSocialLinks(links: IUserSocialLinks | null): void {
    const l = links ?? {};
    this.editForm.patchValue({
      facebook: l.facebook ?? '',
      instagram: l.instagram ?? '',
      hotvips: l.hotvips ?? '',
      sexlog: l.sexlog ?? '',
      d4swing: l.d4swing ?? '',
      privacy: l.privacy ?? '',
      onlyfans: l.onlyfans ?? '',
      fansly: l.fansly ?? '',
      linktree: l.linktree ?? '',
      twitter: l.twitter ?? '',
      tiktok: l.tiktok ?? '',
      youtube: l.youtube ?? '',
      linkedin: l.linkedin ?? '',
      snapchat: l.snapchat ?? '',
    }, { emitEvent: false });
  }

  private syncOrientationControls(gender: string): void {
    const isCouple = ['casal-ele-ele', 'casal-ele-ela', 'casal-ela-ela'].includes(gender);

    const orientation = this.editForm.get('orientation')!;
    const p1 = this.editForm.get('partner1Orientation')!;
    const p2 = this.editForm.get('partner2Orientation')!;

    if (isCouple) {
      orientation.disable({ emitEvent: false });
      orientation.setValue('', { emitEvent: false });

      p1.enable({ emitEvent: false });
      p2.enable({ emitEvent: false });

      // opcional: tornar required quando casal
      // p1.setValidators([Validators.required]);
      // p2.setValidators([Validators.required]);
    } else {
      orientation.enable({ emitEvent: false });

      p1.disable({ emitEvent: false });
      p2.disable({ emitEvent: false });
      p1.setValue('', { emitEvent: false });
      p2.setValue('', { emitEvent: false });

      // p1.clearValidators();
      // p2.clearValidators();
    }

    p1.updateValueAndValidity({ emitEvent: false });
    p2.updateValueAndValidity({ emitEvent: false });
    orientation.updateValueAndValidity({ emitEvent: false });
  }

  private loadEstados$() {
    return from(fetch('https://servicodados.ibge.gov.br/api/v1/localidades/estados').then(r => r.json())).pipe(
      map((estados: any[]) => (estados ?? []).sort((a, b) => a.nome.localeCompare(b.nome))),
      catchError(err => this.handleError$(err, 'loadEstados', 'Erro ao carregar estados.').pipe(map(() => []))),
    );
  }

  private loadMunicipios$(estadoSigla: string) {
    const sigla = (estadoSigla ?? '').trim();
    if (!sigla) return of([]);

    return from(fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${sigla}/municipios`).then(r => r.json())).pipe(
      map((muns: any[]) => (muns ?? []).sort((a, b) => a.nome.localeCompare(b.nome))),
      catchError(err => this.handleError$(err, 'loadMunicipios', 'Erro ao carregar municípios.').pipe(map(() => []))),
    );
  }

  private compactSocialLinks(input: Record<string, unknown>): IUserSocialLinks {
    const out: IUserSocialLinks = {};
    Object.entries(input).forEach(([k, v]) => {
      const s = (v ?? '').toString().trim();
      if (s) (out as any)[k] = s;
    });
    return out;
  }

  private handleError$(err: unknown, context: string, userMessage: string) {
    const e = err instanceof Error ? err : new Error(String(err ?? 'unknown'));
    (e as any).context = `EditUserProfileComponent.${context}`;
    (e as any).silent = true;

    try { this.globalError.handleError(e); } catch { }
    this.notify.showError(userMessage);

    return EMPTY;
  }
} // Linha 368, fim EditUserProfileComponent
