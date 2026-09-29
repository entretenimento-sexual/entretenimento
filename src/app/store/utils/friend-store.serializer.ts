// src/app/store/utils/friend-store.serializer.ts
// =============================================================================
// Serialização Friend => Store-safe
//
// Responsabilidade:
// - converter documentos de amizade vindos do Firestore para objetos seguros
//   para Store/UI;
// - remover valores não serializáveis, como Timestamp;
// - manter a função pura, previsível e sem efeitos colaterais.
//
// Importante:
// - este arquivo NÃO deve usar console.log;
// - este arquivo NÃO deve depender de services Angular;
// - debug operacional deve ficar no repo/facade/service chamador, via
//   PrivacyDebugLoggerService e flag DEBUG_FRIENDS.
// =============================================================================

import { toEpoch } from '../../core/utils/epoch-utils';
import type {
  FriendDoc,
  Friend,
} from 'src/app/core/interfaces/friendship/friend.interface';

