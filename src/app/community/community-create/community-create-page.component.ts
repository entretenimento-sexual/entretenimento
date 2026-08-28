// src/app/community/community-create/community-create-page.component.ts
// -----------------------------------------------------------------------------
// CRIAÇÃO DE COMUNIDADE
// -----------------------------------------------------------------------------
// Comunidade é um grupo permanente de pessoas unidas por interesse, identidade,
// região ou objetivo. O formulário é mobile-first, tipado e reativo; propriedade,
// moderação, entitlement e identificadores permanecem sob autoridade da Function.
// -----------------------------------------------------------------------------

import { AsyncPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import {
  catchError,
  distinctUntilChanged,
  filter,
  finalize,
  map,
  Observable,
  of,
  shareReplay,
  startWith,
  Subject,
  switchMap,
  take,
} from 'rxjs';

import { getSocialSpaceDefinition } from 'src/app/core/domain/social-space.definition';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import { GlobalErrorHandlerService } from 'src/app/core/services/error-handler/global-error-handler.service';
import { COMMUNITY_CREATE_RETURN_URL } from 'src/app/subscriptions/domain/subscription-flow-context.model';
import {
  COMMUNITY_MEMBER_LIMIT_OPTIONS,
  CommunityCreationCapability,
  CommunityEffectiveMemberLimit,
  CommunityMemberLimit,
  communityMemberLimitRequiredRole,
} from '../data-access/community-capacity.model';
import {
  CommunityCreateJoinPolicy,
  CommunityCreateTheme,
} from '../data-access/community-create.model';
import { CommunityCreateRepository } from '../data-access/community-create.repository';
import {
  CommunityTagCategory,
  CommunityTagDefinition,
  MAX_COMMUNITY_TAGS,
  MIN_COMMUNITY_TAGS,
} from '../data-access/community-tag.model';
import { CommunityTagRepository } from '../data-access/community-tag.repository';
import { CommunityCreationGateService } from './community-creation-gate.service';

type CommunityCreateForm = FormGroup<{
  name: FormControl<string>;
  theme: FormControl<CommunityCreateTheme>;
  description: FormControl<string>;
  rules: FormControl<string>;
  joinPolicy: FormControl<CommunityCreateJoinPolicy>;
  memberLimit: FormControl<CommunityMemberLimit>;
  tagIds: FormControl<readonly string[]>;
}>;

interface CommunityCreatePreviewVm {
  name: string;
  initials: string;
  theme: string;
  join: string;
  memberLimit: CommunityMemberLimit;
  tagCount: number;
}

type CommunityTagCatalogState =
  | { status: 'loading'; items: readonly CommunityTagDefinition[] }
  | { status: 'ready'; items: readonly CommunityTagDefinition[] }
  | { status: 'error'; items: readonly CommunityTagDefinition[] };

type CommunityCreationState =
  | { status: 'loading'; capability: null }
  | { status: 'ready'; capability: CommunityCreationCapability }
  | { status: 'error'; capability: null };

function communityTagCountValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = Array.isArray(control.value) ? control.value : [];
    return value.length >= MIN_COMMUNITY_TAGS && value.length <= MAX_COMMUNITY_TAGS
      ? null
      : { communityTagCount: true };
  };
}

@Component({
  selector: 'app-community-create-page',
  standalone: true,
  imports: [AsyncPipe, ReactiveFormsModule, RouterLink],
  templateUrl: './community-create-page.component.html',
  styleUrl: './community-create-page.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunityCreatePageComponent {
  private readonly repository = inject(CommunityCreateRepository);
  private readonly tagRepository = inject(CommunityTagRepository);
  private readonly creationGate = inject(CommunityCreationGateService);
  private readonly notifications = inject(ErrorNotificationService);
  private readonly globalError = inject(GlobalErrorHandlerService);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);
  private readonly requestId = this.createRequestId();
  private readonly tagCatalogReload$ = new Subject<void>();
  readonly communityCreateReturnUrl = COMMUNITY_CREATE_RETURN_URL;
  private readonly creationCapabilityReload$ = new Subject<void>();

  readonly submitting = signal(false);
  readonly communityDefinition = getSocialSpaceDefinition('community');
  readonly maxCommunityTags = MAX_COMMUNITY_TAGS;
  readonly memberLimitOptions = COMMUNITY_MEMBER_LIMIT_OPTIONS;

  readonly themeOptions: ReadonlyArray<{
    value: CommunityCreateTheme;
    label: string;
    description: string;
    icon: string;
  }> = [
    {
      value: 'regional',
      label: 'Região ou cidade',
      description: 'Aproxima pessoas que compartilham o mesmo lugar.',
      icon: 'fa-location-dot',
    },
    {
      value: 'interests',
      label: 'Interesses',
      description: 'Reúne pessoas em torno de uma curiosidade comum.',
      icon: 'fa-compass',
    },
    {
      value: 'identity',
      label: 'Identidade e afinidades',
      description: 'Cria um espaço de identificação e pertencimento.',
      icon: 'fa-people-group',
    },
    {
      value: 'events',
      label: 'Eventos e encontros',
      description: 'Organiza conversas antes e depois dos encontros.',
      icon: 'fa-calendar-days',
    },
    {
      value: 'lifestyle',
      label: 'Estilo de vida',
      description: 'Compartilha hábitos, experiências e referências.',
      icon: 'fa-sparkles',
    },
    {
      value: 'other',
      label: 'Outro tema',
      description: 'Você define uma proposta diferente das anteriores.',
      icon: 'fa-shapes',
    },
  ];

  readonly joinPolicyOptions = [
    {
      value: 'approval' as const,
      label: 'Com acolhimento',
      description: 'A gestão conhece cada solicitação antes da entrada.',
      icon: 'fa-user-check',
    },
    {
      value: 'open' as const,
      label: 'Portas abertas',
      description: 'Perfis elegíveis entram e participam imediatamente.',
      icon: 'fa-door-open',
    },
  ];

  readonly form: CommunityCreateForm = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.minLength(2),
        Validators.maxLength(80),
      ],
    }),
    theme: new FormControl<CommunityCreateTheme>('interests', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    description: new FormControl('', {
      nonNullable: true,
      validators: [Validators.maxLength(240)],
    }),
    rules: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.minLength(10),
        Validators.maxLength(1_200),
      ],
    }),
    joinPolicy: new FormControl<CommunityCreateJoinPolicy>('approval', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    memberLimit: new FormControl<CommunityMemberLimit>(25, {
      nonNullable: true,
      validators: [Validators.required],
    }),
    tagIds: new FormControl<readonly string[]>([], {
      nonNullable: true,
      validators: [communityTagCountValidator()],
    }),
  });

  readonly creationState$: Observable<CommunityCreationState> =
    this.creationCapabilityReload$.pipe(
      startWith(undefined),
      switchMap(() => this.repository.getCreationCapability$().pipe(
        map((capability): CommunityCreationState => ({
          status: 'ready',
          capability,
        })),
        catchError((error: unknown) => {
          this.reportCreationCapabilityError(error);
          return of<CommunityCreationState>({
            status: 'error',
            capability: null,
          });
        }),
        startWith<CommunityCreationState>({
          status: 'loading',
          capability: null,
        })
      )),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  constructor() {
    this.creationState$.pipe(
      filter((state): state is {
        status: 'ready';
        capability: CommunityCreationCapability;
      } => state.status === 'ready' && !state.capability.canCreate),
      map((state) => state.capability),
      distinctUntilChanged((previous, current) =>
        previous.reason === current.reason
        && previous.sponsorRole === current.sponsorRole
        && previous.currentOwnedCommunities === current.currentOwnedCommunities
        && previous.maxOwnedCommunities === current.maxOwnedCommunities
      ),
      switchMap((capability) =>
        this.creationGate.handleBlockedCapability$(capability)
      ),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe();
  }

  readonly preview$: Observable<CommunityCreatePreviewVm> =
    this.form.valueChanges.pipe(
      startWith(this.form.getRawValue()),
      map(() => {
        const value = this.form.getRawValue();
        const name = value.name.trim() || 'Sua nova Comunidade';
        return {
          name,
          initials: this.buildInitials(name),
          theme: this.themeOptions.find((option) => option.value === value.theme)
            ?.label ?? 'Interesses',
          join: value.joinPolicy === 'open'
            ? 'Entrada imediata'
            : 'Com aprovação',
          memberLimit: value.memberLimit,
          tagCount: value.tagIds.length,
        };
      }),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  readonly tagCatalogState$: Observable<CommunityTagCatalogState> =
    this.tagCatalogReload$.pipe(
      startWith(undefined),
      switchMap(() =>
        this.tagRepository.getCommunityTagCatalog$().pipe(
          map((catalog): CommunityTagCatalogState => ({
            status: catalog.items.length > 0 ? 'ready' : 'error',
            items: catalog.items,
          })),
          catchError((error: unknown) => {
            this.reportTagCatalogError(error);
            return of<CommunityTagCatalogState>({ status: 'error', items: [] });
          }),
          startWith<CommunityTagCatalogState>({ status: 'loading', items: [] })
        )
      ),
      shareReplay({ bufferSize: 1, refCount: true })
    );

  retryTagCatalog(): void {
    this.tagCatalogReload$.next();
  }

  retryCreationCapability(): void {
    this.creationCapabilityReload$.next();
  }

  creationPlanLabel(capability: CommunityCreationCapability): string {
    return this.creationGate.planLabel(capability);
  }

  tagsForCategory(
    items: readonly CommunityTagDefinition[],
    category: CommunityTagCategory
  ): readonly CommunityTagDefinition[] {
    return items.filter((tag) => tag.category === category);
  }

  tagCategoryLabel(category: CommunityTagCategory): string {
    if (category === 'intent') return 'Objetivos';
    if (category === 'practice') return 'Interesses';
    return 'Público e afinidades';
  }

  isTagSelected(tagId: string): boolean {
    return this.form.controls.tagIds.value.includes(tagId);
  }

  toggleTag(tagId: string): void {
    const control = this.form.controls.tagIds;
    const current = [...control.value];
    const index = current.indexOf(tagId);

    if (index >= 0) {
      current.splice(index, 1);
    } else if (current.length >= MAX_COMMUNITY_TAGS) {
      this.notifications.showWarning(
        `Escolha no máximo ${MAX_COMMUNITY_TAGS} interesses para manter a Comunidade bem definida.`
      );
      return;
    } else {
      current.push(tagId);
    }

    control.setValue(current);
    control.markAsTouched();
  }

  selectMemberLimit(
    memberLimit: CommunityMemberLimit,
    allowed: readonly CommunityMemberLimit[]
  ): void {
    if (!allowed.includes(memberLimit)) {
      this.notifications.showWarning(
        `${communityMemberLimitRequiredRole(memberLimit)} é necessário para escolher essa capacidade.`
      );
      return;
    }

    this.form.controls.memberLimit.setValue(memberLimit);
    this.form.controls.memberLimit.markAsDirty();
  }

  isMemberLimitSelected(memberLimit: CommunityMemberLimit): boolean {
    return this.form.controls.memberLimit.value === memberLimit;
  }

  memberLimitLabel(memberLimit: CommunityEffectiveMemberLimit): string {
    return new Intl.NumberFormat('pt-BR').format(memberLimit);
  }

  memberLimitDescription(memberLimit: CommunityMemberLimit): string {
    if (memberLimit <= 25) return 'Um círculo próximo e fácil de acompanhar.';
    if (memberLimit <= 100) return 'Espaço para uma comunidade em crescimento.';
    if (memberLimit <= 250) return 'Uma rede ampla com gestão estruturada.';
    return 'Grande alcance para comunidades consolidadas.';
  }

  memberLimitPlanLabel(memberLimit: CommunityMemberLimit): string {
    return communityMemberLimitRequiredRole(memberLimit);
  }

  submit(): void {
    if (this.submitting()) return;

    this.creationState$.pipe(
      filter((state) => state.status !== 'loading'),
      take(1),
      switchMap((state) => {
        if (state.status !== 'ready') {
          this.notifications.showWarning(
            'Aguarde a verificação da sua permissão para criar.'
          );
          return of(false);
        }

        if (!state.capability.canCreate) {
          return this.creationGate.handleBlockedCapability$(state.capability).pipe(
            map(() => false)
          );
        }

        return of(true);
      })
    ).subscribe((canSubmit) => {
      if (canSubmit) this.submitEligibleCommunity();
    });
  }

  private submitEligibleCommunity(): void {
    if (this.submitting()) return;

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.notifications.showWarning(
        'Revise os campos obrigatórios da Comunidade.'
      );
      return;
    }

    const value = this.form.getRawValue();
    this.submitting.set(true);

    this.repository
      .createCommunity$({
        requestId: this.requestId,
        name: value.name.trim(),
        theme: value.theme,
        description: this.optional(value.description),
        rules: value.rules.trim(),
        joinPolicy: value.joinPolicy,
        memberLimit: value.memberLimit,
        tagIds: value.tagIds,
      })
      .pipe(finalize(() => this.submitting.set(false)))
      .subscribe({
        next: (result) => {
          this.notifications.showSuccess(
            result.created
              ? 'Comunidade criada.'
              : 'Comunidade recuperada com segurança.'
          );
          void this.router.navigate([
            '/dashboard/comunidades',
            result.communityId,
          ]);
        },
        error: (error: unknown) => this.reportError(error),
      });
  }

  private optional(value: string): string | null {
    const normalized = String(value ?? '').trim();
    return normalized || null;
  }

  private buildInitials(name: string): string {
    const words = name
      .split(/\s+/)
      .map((word) => word.trim())
      .filter(Boolean);
    return words.slice(0, 2).map((word) => word[0]?.toUpperCase()).join('')
      || 'NC';
  }

  private createRequestId(): string {
    try {
      const randomUuid = globalThis.crypto?.randomUUID?.();
      if (randomUuid) return randomUuid;
    } catch {
      // O fallback mantém a idempotência desta sessão de formulário.
    }

    return `grupo-${Date.now().toString(36)}-${Math.random()
      .toString(36)
      .slice(2, 14)}`;
  }

  private creationErrorMessage(error: unknown): string {
    const source = (error ?? {}) as {
      code?: unknown;
      details?: { reason?: unknown; recommendedAction?: unknown };
    };
    const code = String(source.code ?? '').replace(/^functions\//, '');
    const recommendedAction = String(source.details?.recommendedAction ?? '');
    const reason = String(source.details?.reason ?? '');

    if (reason === 'community_creation_limit_reached') {
      return 'Seu plano atingiu a quantidade de Comunidades próprias.';
    }

    if (reason === 'community_creation_subscription_required') {
      return 'Uma assinatura Basic ou superior é necessária para criar Comunidades.';
    }

    if (code === 'permission-denied') {
      return recommendedAction === 'upgrade_subscription'
        ? 'Seu plano atual não permite a capacidade escolhida para esta Comunidade.'
        : 'Sua conta não pode criar esta Comunidade neste momento.';
    }

    if (code === 'failed-precondition') {
      if (recommendedAction === 'complete_profile') {
        return 'Complete seu perfil antes de criar uma Comunidade.';
      }
      if (recommendedAction === 'confirm_adult_access') {
        return 'Confirme seu acesso adulto antes de criar uma Comunidade.';
      }
      return 'Sua conta precisa de uma atualização antes de criar uma Comunidade.';
    }

    if (code === 'already-exists') {
      return 'Não foi possível reservar esta Comunidade. Tente novamente.';
    }

    return 'Não foi possível criar a Comunidade agora.';
  }

  private reportTagCatalogError(error: unknown): void {
    try {
      this.notifications.showError(
        'Não foi possível carregar os interesses disponíveis. Tente novamente.'
      );
    } catch {
      // O diagnóstico centralizado abaixo permanece ativo.
    }

    this.reportTechnicalError(error, 'getCommunityTagCatalog');
  }

  private reportCreationCapabilityError(error: unknown): void {
    try {
      this.notifications.showError(
        'Não foi possível verificar a criação de Comunidades agora.'
      );
    } catch {
      // O diagnóstico centralizado abaixo permanece ativo.
    }

    this.reportTechnicalError(error, 'getCommunityCreationCapability');
  }

  private reportError(error: unknown): void {
    try {
      this.notifications.showError(this.creationErrorMessage(error));
    } catch {
      // A observabilidade abaixo permanece ativa.
    }

    this.reportTechnicalError(error, 'createCommunity');
  }

  private reportTechnicalError(error: unknown, op: string): void {
    try {
      const normalized = error instanceof Error ? error : new Error(String(error));
      const contextual = normalized as Error & {
        context?: unknown;
        skipUserNotification?: boolean;
      };
      contextual.context = {
        scope: 'CommunityCreatePageComponent',
        op,
      };
      contextual.skipUserNotification = true;
      this.globalError.handleError(contextual);
    } catch {
      // Falha secundária não interrompe o estado visual.
    }
  }
}
