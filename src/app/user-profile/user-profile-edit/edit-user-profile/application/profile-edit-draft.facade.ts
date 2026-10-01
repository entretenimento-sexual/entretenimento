import { DestroyRef, Injectable, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormGroup } from '@angular/forms';
import { debounceTime, filter, tap } from 'rxjs/operators';

import { LocalDraftService } from 'src/app/core/services/drafts/local-draft.service';

type ProfileDraft = Record<string, string>;

const PROFILE_DRAFT_FIELDS = [
  'nickname',
  'estado',
  'municipio',
  'gender',
  'orientation',
  'idade',
  'partner1Orientation',
  'partner2Orientation',
  'descricao',
] as const;

@Injectable()
export class ProfileEditDraftFacade {
  private readonly destroyRef = inject(DestroyRef);
  private draftReady = false;
  private draftKey = '';

  constructor(
    private readonly localDraft: LocalDraftService
  ) {}

  bind(
    form: FormGroup,
    uid: string,
    isSaving: () => boolean
  ): void {
    this.draftKey = `profile-edit:${String(uid ?? '').trim()}`;

    form.valueChanges
      .pipe(
        debounceTime(500),
        filter(
          () =>
            this.draftReady &&
            form.dirty &&
            !isSaving()
        ),
        tap(() => {
          const rawValue = form.getRawValue();
          const draft: ProfileDraft = {};

          PROFILE_DRAFT_FIELDS.forEach((field) => {
            draft[field] = String(rawValue[field] ?? '');
          });

          this.localDraft.save(this.draftKey, draft);
        }),
        takeUntilDestroyed(this.destroyRef)
      )
      .subscribe();
  }

  restore(form: FormGroup): void {
    if (this.draftReady || !this.draftKey) return;

    form.markAsPristine();
    const draft = this.localDraft.load<ProfileDraft>(this.draftKey);
    this.draftReady = true;

    if (!draft) return;

    const patch: ProfileDraft = {};

    PROFILE_DRAFT_FIELDS.forEach((field) => {
      if (typeof draft[field] === 'string') {
        patch[field] = draft[field];
      }
    });

    form.patchValue(patch, { emitEvent: true });
    form.markAsDirty();
  }

  hasUnsavedChanges(form: FormGroup, isSaving: boolean): boolean {
    return this.draftReady && form.dirty && !isSaving;
  }

  discard(form: FormGroup): void {
    this.remove();
    form.markAsPristine();
  }

  clearAfterSave(form: FormGroup): void {
    this.remove();
    form.markAsPristine();
  }

  private remove(): void {
    if (!this.draftKey) return;
    this.localDraft.remove(this.draftKey);
  }
}
