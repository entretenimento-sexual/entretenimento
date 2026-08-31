// src/app/messaging/direct-chat/presentation/direct-chat-public-identity.component.ts
// -----------------------------------------------------------------------------
// DIRECT CHAT PUBLIC IDENTITY ADAPTER
// -----------------------------------------------------------------------------
// Adaptador fino entre o estado canônico do DirectChatFacade e os componentes
// universais de identidade/prévia pública. Não consulta Firestore e não mantém
// um segundo estado de perfil.
// -----------------------------------------------------------------------------

import { AsyncPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
} from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import {
  combineLatest,
  distinctUntilChanged,
  map,
  shareReplay,
} from 'rxjs';

import { PublicUserIdentityComponent } from 'src/app/core/components/public-user-identity/public-user-identity.component';
import { PublicUserPreviewTriggerDirective } from 'src/app/core/components/public-user-preview-popover/public-user-preview-trigger.directive';
import {
  normalizePublicUserIdentity,
  type PublicUserIdentity,
} from 'src/app/core/domain/public-user-identity/public-user-identity.model';
import type { PublicUserPreview } from 'src/app/core/domain/public-user-preview/public-user-preview.model';
import type { DirectChatListItem } from '../models/direct-chat.models';
import { DirectChatFacade } from '../application/direct-chat.facade';

const DIRECT_CHAT_IDENTITY_FALLBACK: PublicUserIdentity = {
  nickname: 'Conversa direta',
  label: 'Conversa direta',
  avatarUrl: null,
};

interface DirectChatPublicIdentityViewModel {
  readonly identity: PublicUserIdentity;
  readonly preview: PublicUserPreview | null;
  readonly profileRoute: readonly string[] | null;
}

@Component({
  selector: 'app-direct-chat-public-identity',
  standalone: true,
  imports: [
    AsyncPipe,
    PublicUserIdentityComponent,
    PublicUserPreviewTriggerDirective,
  ],
  template: `
    @if (viewModel$ | async; as vm) {
      <div
        class="direct-chat-public-identity"
        [appPublicUserPreviewTrigger]="vm.preview"
        [publicUserPreviewProfileRoute]="vm.profileRoute"
        #quickPreview="publicUserPreviewTrigger"
      >
        <app-public-user-identity
          [identity]="vm.identity"
          density="comfortable"
          emphasis="strong"
          [contextText]="contextText()"
        />

        @if (vm.preview) {
          <button
            type="button"
            class="direct-chat-public-identity__preview"
            [attr.aria-label]="'Ver resumo de ' + vm.identity.nickname"
            [attr.aria-expanded]="quickPreview.isOpen()"
            title="Ver resumo do perfil"
            (click)="quickPreview.toggle()"
          >
            <i class="fas fa-circle-info" aria-hidden="true"></i>
            <span class="sr-only">Ver resumo do perfil</span>
          </button>
        }
      </div>
    }
  `,
  styleUrl: './direct-chat-public-identity.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DirectChatPublicIdentityComponent {
  private readonly directChatFacade = inject(DirectChatFacade);

  readonly chatId = input<string | null | undefined>(null);
  readonly fallbackName = input<string | null | undefined>(null);
  readonly fallbackPhotoURL = input<string | null | undefined>(null);
  readonly contextText = input('Conversa direta');

  private readonly selectedItem$ = combineLatest([
    this.directChatFacade.items$,
    toObservable(this.chatId),
  ]).pipe(
    map(([items, chatId]): DirectChatListItem | null => {
      const safeChatId = String(chatId ?? '').trim();
      return safeChatId
        ? (items ?? []).find((candidate) => candidate.id === safeChatId) ?? null
        : null;
    }),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly identity$ = combineLatest([
    this.selectedItem$,
    toObservable(this.fallbackName),
    toObservable(this.fallbackPhotoURL),
  ]).pipe(
    map(([item, fallbackName, fallbackPhotoURL]) =>
      normalizePublicUserIdentity(
        item?.otherParticipantIdentity ?? {
          profileId: item?.otherParticipantUid ?? null,
          nickname:
            item?.otherParticipantNickname
            ?? String(fallbackName ?? '').trim(),
          avatarUrl:
            item?.otherParticipantPhotoURL
            ?? String(fallbackPhotoURL ?? '').trim(),
        }
      ) ?? DIRECT_CHAT_IDENTITY_FALLBACK
    ),
    distinctUntilChanged((previous, current) =>
      previous.profileId === current.profileId
      && previous.nickname === current.nickname
      && previous.avatarUrl === current.avatarUrl
      && previous.identityCode === current.identityCode
      && previous.identityShortLabel === current.identityShortLabel
      && previous.city === current.city
      && previous.state === current.state
    ),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly preview$ = this.selectedItem$.pipe(
    map((item) => item?.otherParticipantPreview ?? null),
    shareReplay({ bufferSize: 1, refCount: true })
  );

  readonly viewModel$ = combineLatest([
    this.identity$,
    this.preview$,
  ]).pipe(
    map(([identity, preview]): DirectChatPublicIdentityViewModel => ({
      identity,
      preview,
      profileRoute: preview?.identity.profileId
        ? ['/perfil', preview.identity.profileId]
        : null,
    })),
    shareReplay({ bufferSize: 1, refCount: true })
  );
}
