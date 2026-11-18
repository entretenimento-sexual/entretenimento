import { Directive, Injector, Input, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  NEVER, ReplaySubject, concat, distinctUntilChanged, finalize, of, switchMap,
} from 'rxjs';

import {
  ProfileAvatarReadService,
  parseProfileAvatarReference,
} from 'src/app/core/services/image-handling/profile-avatar-read.service';

const DEFAULT_AVATAR = 'assets/imagem-padrao.webp';

@Directive({
  selector: 'img[appProfileAvatar]',
  standalone: true,
  host: { '[src]': 'src()' },
})
export class ProfileAvatarDirective {
  private readonly injector = inject(Injector);
  private readonly source$ = new ReplaySubject<string>(1);

  readonly src = signal(DEFAULT_AVATAR);

  @Input()
  set appProfileAvatar(source: string | null | undefined) {
    this.source$.next(String(source ?? '').trim());
  }

  constructor() {
    this.source$.pipe(
      distinctUntilChanged(),
      switchMap((source) => {
        const reference = parseProfileAvatarReference(source);
        if (!reference) return of(source || DEFAULT_AVATAR);
        this.src.set(DEFAULT_AVATAR);

        return this.injector.get(ProfileAvatarReadService).read$(reference).pipe(
          switchMap((blob) => {
            if (!blob) return of(DEFAULT_AVATAR);
            const url = URL.createObjectURL(blob);
            return concat(of(url), NEVER).pipe(
              finalize(() => URL.revokeObjectURL(url))
            );
          })
        );
      }),
      takeUntilDestroyed()
    ).subscribe((source) => this.src.set(source));
  }
}
