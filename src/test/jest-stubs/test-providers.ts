// src/test/jest-stubs/test-providers.ts
// Provedores de dependências para testes unitários com Jest
// Inclui stubs para tokens do AngularFire e serviços do app
// Não esquecer de manter os comentários e ferramentas de debug para facilitar a manutenção futura
import { Provider } from '@angular/core';
import { of } from 'rxjs';

import { Firestore } from '@angular/fire/firestore';
import { Auth } from '@angular/fire/auth';
import { Storage } from '@angular/fire/storage';
import { Functions } from '@angular/fire/functions';

// Imports dos seus serviços...
import { FirestoreService } from '../../app/core/services/data-handling/legacy/firestore.service';
import { FirestoreUserQueryService } from '../../app/core/services/data-handling/firestore-user-query.service';
import { AuthService } from '../../app/core/services/autentication/auth.service';
import { ChatService } from '../../app/core/services/batepapo/chat-service/chat.service';
import { UserPreferencesService } from '../../app/core/services/preferences/user-preferences.service';
import { StorageService } from '../../app/core/services/image-handling/storage.service';
import { PhotoFirestoreService } from '../../app/core/services/image-handling/photo-firestore.service';
import { SubscriptionService } from '../../app/core/services/subscriptions/subscription.service';
import { RoomManagementService } from '../../app/core/services/batepapo/room-services/room-management.service';
import { FriendshipService } from '../../app/core/services/interactions/friendship/friendship.service';

export const angularFireTokenStubs: Provider[] = [
  { provide: Firestore, useValue: {} as any },
  { provide: Auth, useValue: {} as any },
  { provide: Storage, useValue: {} as any },
  { provide: Functions, useValue: {} as any },
];

export const appServiceStubs: Provider[] = [
  { provide: FirestoreService, useValue: {} },

  // ✅ precisa ter getUser() nos testes de edição de perfil
  { provide: FirestoreUserQueryService, useValue: { getUser: jest.fn(() => of(null)) } },

  // ✅ precisa ter getLoggedUserUID$() e currentUser/role p/ vários componentes
  {
    provide: AuthService,
    useValue: {
      user$: of(null),
      isAuthenticated$: of(false),
      login: jest.fn(),
      logout: jest.fn(),
      getLoggedUserUID$: jest.fn(() => of('test-uid')),
      currentUser: { uid: 'test-uid', role: 'admin' },
    },
  },

  // ✅ usados por ChatMessagesList etc.
  { provide: ChatService, useValue: { monitorChat: jest.fn(() => of([])), updateMessageStatus: jest.fn() } },

  { provide: UserPreferencesService, useValue: {} },

  {
    provide: FriendshipService, useValue: {
      searchUsers: jest.fn(() => of([])),
      blockUser: jest.fn(() => of(void 0)),
      // adicione métodos usados nos componentes sob teste, se necessário
    }
  },

  { provide: StorageService, useValue: {} },
  { provide: PhotoFirestoreService, useValue: {} },
  { provide: SubscriptionService, useValue: {} },
  { provide: RoomManagementService, useValue: {} },
];

export const commonTestingProviders = (): Provider[] => [
  ...angularFireTokenStubs,
  ...appServiceStubs,
];
