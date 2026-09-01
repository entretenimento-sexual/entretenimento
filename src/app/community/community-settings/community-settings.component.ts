import { AsyncPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  inject,
  input,
  output,
} from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import {
  catchError,
  combineLatest,
  exhaustMap,
  filter,
  map,
  Observable,
  of,
  shareReplay,
  startWith,
  Subject,
  tap,
} from 'rxjs';

import { ApplicationErrorService } from 'src/app/core/services/error-handler/application-error.service';
import { ErrorNotificationService } from 'src/app/core/services/error-handler/error-notification.service';
import {
  CommunityCapacityPreview,
  CommunityEffectiveMemberLimit,
  CommunityMemberLimit,
  CommunityMemberLimitCapabilityOption,
  communityMemberLimitRequirementLabel,
} from '../data-access/community-capacity.model';
import type { CommunityPreviewViewerRole } from '../data-access/community-preview.model';
import {
  CommunityEditableSettings,
  CommunitySettingsJoinPolicy,
} from '../data-access/community-settings.model';
import { CommunitySettingsRepository } from '../data-access/community-settings.repository';
import {
  CommunityTagCategory,
  CommunityTagDefinition,
  MAX_COMMUNITY_TAGS,
  MIN_COMMUNITY_TAGS,
} from '../data-access/community-tag.model';
import { CommunityTagRepository } from '../data-access/community-tag.repository';
import {
  COMMUNITY_SETTINGS_CODE_MESSAGES,
  COMMUNITY_SETTINGS_REASON_MESSAGES,
} from '../presentation/community-error.messages';
import {
  COMMUNITY_SETTINGS_REASON_PRESENTATIONS,
} from '../presentation/community-error.presentations';

type CommunitySettingsForm = FormGroup<{
  name: FormControl<string>;
  description: FormControl<string>;
  rules: FormControl<string>;
  joinPolicy: FormControl<CommunitySettingsJoinPolicy>;
  membersCanInvite: FormControl<boolean>;
  memberLimit: FormControl<CommunityMemberLimit | null>;
  tagIds: FormControl<readonly string[]>;
}>;

type CommunityTagCatalogState =
  | { status: 'loading'; items: readonly CommunityTagDefinition[] }
  | { status: 'ready'; items: readonly CommunityTagDefinition[] }
  | { status: 'error'; items: readonly CommunityTagDefinition[] };

type CommunitySettingsActionState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' };

interface CommunitySettingsSaveCommand extends CommunityEditableSettings {
  requestId: string;
}

function communityTagCountValidator(): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    const value = Array.isArray(control.value) ? control.value : [];
    return value.length >= MIN_COMMUNITY_TAGS
      && value.length <= MAX_COMMUNITY_TAGS
      ? null
      : { communityTagCount: true };
  };
}

@Component({
  selector: 'app-community-settings',
  standalone: true,
  imports: [AsyncPipe, ReactiveFormsModule],
  templateUrl: './community-settings.component.html',
  styleUrl: './community-settings.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CommunitySettingsComponent {
  private readonly repository = inject(CommunitySettingsRepository);
  private readonly tagRepository = inject(CommunityTagRepository);
  private readonly notifications = inject(ErrorNotificationService);
  private readonly applicationError = inject(ApplicationErrorService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly saveRequests$ = new Subject<CommunitySettingsSaveCommand>();
  private readonly tagCatalogReload$ = new Subject<void>();

  readonly communityId = input.required<string>();
  readonly settings = input<CommunityEditableSettings | null>(null);
  readonly viewerRole = input<CommunityPreviewViewerRole | null>(null);
  readonly capacity = input<CommunityCapacityPreview | null>(null);
  readonly settingsChanged = output<void>();
  readonly maxCommunityTags = MAX_COMMUNITY_TAGS;
  readonly tagCategories: readonly CommunityTagCategory[] = [
    'intent',
    'practice',
    'audience',
  ];

  readonly joinPolicyOptions: ReadonlyArray<{
    value: CommunitySettingsJoinPolicy;
    label: string;
    description: string;
  }> = [
    {
      value: 'open',
      label: 'Aberta',
      description: 'Pessoas elegíveis entram imediatamente.',
    },
    {
      value: 'approval',
      label: 'Por aprovação',
      description: 'A gestão revisa cada solicitação de entrada.',
    },
    {
      value: 'invite_only',
      label: 'Somente convite',
      description: 'Não há solicitação direta de entrada.',
    },
  ];

  readonly form: CommunitySettingsForm = new FormGroup({
    name: new FormControl('', {
      nonNullable: true,
      validators: [
        Validators.required,
        Validators.minLength(2),
        Validators.maxLength(80),
      ],
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
    joinPolicy: new FormControl<CommunitySettingsJoinPolicy>('approval', {
      nonNullable: true,
      validators: [Validators.required],
    }),
    membersCanInvite: new FormControl(false, { nonNullable: true }),
    memberLimit: new FormControl<CommunityMemberLimit | null>(null, {
      validators: [Validators.required],
    }),
    tagIds: new FormControl<readonly string[]>([], {
      nonNullable: true,
      validators: [communityTagCountValidator()],
    }),
  });

  readonly tagCatalogState$: Observable<CommunityTagCatalogState> =
    this.tagCatalogReload$.pipe(
      startWith(undefined),
      exhaustMap(() =>
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

  readonly action$ = this.saveRequests$.pipe(
    exhaustMap((command) =>
      this.repository.updateSettings$({
        ...command,
        communityId: this.communityId().trim(),
      }).pipe(
        tap((result) => {
          this.notifications.showSuccess(
            result.updated
              ? 'Configurações da Comunidade atualizadas.'
              : 'As configurações já estavam atualizadas.'
          );
          this.form.markAsPristine();
          this.settingsChanged.emit();
        }),
        map((): CommunitySettingsActionState => ({ status: 'idle' })),
        startWith<CommunitySettingsActionState>({ status: 'loading' }),
        catchError((error: unknown) => {
          this.reportSettingsError(error);
          return of<CommunitySettingsActionState>({ status: 'error' });
        })
      )
    ),
    startWith<CommunitySettingsActionState>({ status: 'idle' }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  constructor() {
    combineLatest([
      toObservable(this.settings),
      toObservable(this.viewerRole),
      toObservable(this.capacity),
    ]).pipe(
      filter(
        (value): value is [
          CommunityEditableSettings,
          CommunityPreviewViewerRole | null,
          CommunityCapacityPreview | null,
        ] => value[0] !== null
      ),
      takeUntilDestroyed(this.destroyRef)
    ).subscribe(([settings, viewerRole]) => {
      this.form.controls.memberLimit.enable({ emitEvent: false });
      this.form.reset({
        name: settings.name,
        description: settings.description ?? '',
        rules: settings.rules,
        joinPolicy: settings.joinPolicy,
        membersCanInvite: settings.membersCanInvite,
        memberLimit: settings.memberLimit,
        tagIds: [...settings.tagIds],
      }, { emitEvent: false });

      if (viewerRole !== 'owner') {
        this.form.controls.memberLimit.disable({ emitEvent: false });
      }
    });
  }

  retryTagCatalog(): void {
    this.tagCatalogReload$.next();
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
        `Escolha no máximo ${MAX_COMMUNITY_TAGS} interesses.`
      );
      return;
    } else {
      current.push(tagId);
    }

    control.setValue(current);
    control.markAsTouched();
    control.markAsDirty();
  }

  selectMemberLimit(option: CommunityMemberLimitCapabilityOption): void {
    if (this.viewerRole() !== 'owner') return;
    const capacity = this.capacity();

    if (!capacity || !option.allowed) {
      this.notifications.showWarning(
        `${communityMemberLimitRequirementLabel(option.requirement)} é necessário para escolher essa capacidade.`
      );
      return;
    }

    if (option.memberLimit < capacity.memberCount) {
      this.notifications.showWarning(
        `O limite não pode ser menor que os ${capacity.memberCount} membros atuais.`
      );
      return;
    }

    this.form.controls.memberLimit.setValue(option.memberLimit);
    this.form.controls.memberLimit.markAsDirty();
  }

  memberLimitLabel(memberLimit: CommunityEffectiveMemberLimit): string {
    return new Intl.NumberFormat('pt-BR').format(memberLimit);
  }

  memberLimitPlanLabel(
    option: CommunityMemberLimitCapabilityOption
  ): string {
    return communityMemberLimitRequirementLabel(option.requirement);
  }

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      this.notifications.showWarning(
        'Revise os campos obrigatórios das configurações.'
      );
      return;
    }

    if (this.form.pristine) {
      this.notifications.showWarning('Nenhuma alteração para salvar.');
      return;
    }

    const value = this.form.getRawValue();
    if (value.memberLimit === null) {
      this.notifications.showWarning(
        'Não foi possível validar a capacidade atual da Comunidade.'
      );
      return;
    }

    this.saveRequests$.next({
      requestId: this.createRequestId(),
      name: value.name.trim(),
      description: this.optional(value.description),
      rules: value.rules.trim(),
      joinPolicy: value.joinPolicy,
      membersCanInvite: value.membersCanInvite,
      memberLimit: value.memberLimit,
      tagIds: value.tagIds,
    });
  }

  private optional(value: string): string | null {
    const normalized = String(value ?? '').trim();
    return normalized || null;
  }

  private createRequestId(): string {
    try {
      const randomUuid = globalThis.crypto?.randomUUID?.();
      if (randomUuid) return randomUuid;
    } catch {
      // O fallback preserva idempotência suficiente para esta ação local.
    }

    const entropy = Math.random().toString(36).slice(2, 14);
    return `settings-${Date.now().toString(36)}-${entropy}`.slice(0, 64);
  }

  private reportTagCatalogError(error: unknown): void {
    this.applicationError.report(error, {
      feature: 'community',
      operation: 'loadTagCatalog',
      fallbackMessage: 'Não foi possível carregar os interesses da Comunidade.',
      notification: 'none',
      metadata: {
        scope: 'CommunitySettingsComponent',
        communityId: this.communityId().trim(),
        viewerRole: this.viewerRole(),
      },
    });
  }

  private reportSettingsError(error: unknown): void {
    this.applicationError.report(error, {
      feature: 'community',
      operation: 'updateCommunitySettings',
      fallbackMessage: 'Não foi possível salvar as configurações da Comunidade.',
      reasonMessages: COMMUNITY_SETTINGS_REASON_MESSAGES,
      reasonPresentations: COMMUNITY_SETTINGS_REASON_PRESENTATIONS,
      codeMessages: COMMUNITY_SETTINGS_CODE_MESSAGES,
      metadata: {
        scope: 'CommunitySettingsComponent',
        communityId: this.communityId().trim(),
        viewerRole: this.viewerRole(),
      },
    });
  }
}
