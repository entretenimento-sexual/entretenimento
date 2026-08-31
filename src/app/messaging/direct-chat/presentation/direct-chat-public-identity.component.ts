// src/app/messaging/direct-chat/presentation/direct-chat-public-identity.component.ts
// -----------------------------------------------------------------------------
// DIRECT CHAT PUBLIC IDENTITY ADAPTER
// -----------------------------------------------------------------------------
// Adaptador fino entre o estado canônico do DirectChatFacade e o componente
// universal PublicUserIdentityComponent. Não possui contrato visual próprio,
// não consulta Firestore e não mantém um segundo estado de identidade.
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
import {
  normalizePublicUserIdentity,
  type PublicUserIdentity,
} from 'src/app/core/domain/public-user-identity/public-user-identity.model';
import { DirectChatFacade } from '../application/direct-chat.facade';

const DIRECT_CHAT_IDENTITY_FALLBACK: PublicUserIdentity = {
  nickname: 'Conversa direta',
  label: 'Conversa direta',
  avatarUrl: null,
};

@Component({
  selector: 'app-direct-chat-public-identity',
  standalone: true,
  imports: [AsyncPipe, PublicUserIdentityComponent],
  template: `
    @if (identity$ | async; as identity) {
      <app-public-user-identity
        [identity]="identity"
        density="comfortable"
        emphasis="strong"
        [contextText]="contextText()"
      />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DirectChatPublicIdentityComponent {
  private readonly directChatFacade = inject(DirectChatFacade);

  readonly chatId = input<string | null | undefined>(null);
  readonly fallbackName = input<string | null | undefined>(null);
  readonly fallbackPhotoURL = input<string | null | undefined>(null);
  readonly contextText = input('Conversa direta');

  readonly identity$ = combineLatest([
    this.directChatFacade.items$,
    toObservable(this.chatId),
    toObservable(this.fallbackName),
    toObservable(this.fallbackPhotoURL),
  ]).pipe(
    map(([items, chatId, fallbackName, fallbackPhotoURL]) => {
      const safeChatId = String(chatId ?? '').trim();
      const item = safeChatId
        ? (items ?? []).find((candidate) => candidate.id === safeChatId) ?? null
        : null;

      return normalizePublicUserIdentity(
        item?.otherParticipantIdentity ?? {
          profileId: item?.otherParticipantUid ?? null,
          nickname:
            item?.otherParticipantNickname
            ?? String(fallbackName ?? '').trim(),
          avatarUrl:
            item?.otherParticipantPhotoURL
            ?? String(fallbackPhotoURL ?? '').trim(),
        }
      ) ?? DIRECT_CHAT_IDENTITY_FALLBACK;
    }),
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
}
