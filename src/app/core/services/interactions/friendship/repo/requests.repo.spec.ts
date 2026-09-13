// src/app/core/services/interactions/friendship/repo/requests.repo.spec.ts
// -----------------------------------------------------------------------------
// FRIENDSHIP CLIENT AUTHORITY CONTRACT
// -----------------------------------------------------------------------------
// Os repositórios Angular são read models. Alterações de amizade, requests,
// cooldowns e bloqueios pertencem exclusivamente às Cloud Functions.
//
// Este contrato é intencionalmente de tipo: se qualquer mutador legado voltar
// a ser exposto por esses repositórios, a compilação do teste falha.
// -----------------------------------------------------------------------------
import { FriendshipRepo } from './facade.repo';
import { CooldownRepo } from './cooldown.repo';
import { RequestsRepo } from './requests.repo';

type HasKey<T, K extends PropertyKey> = K extends keyof T ? true : false;

const requestRepoExposesCreate: HasKey<RequestsRepo, 'createRequest'> = false;
const requestRepoExposesAccept: HasKey<RequestsRepo, 'acceptRequestBatch'> = false;
const requestRepoExposesDecline: HasKey<RequestsRepo, 'declineRequest'> = false;
const requestRepoExposesDeclineWithCooldown: HasKey<
  RequestsRepo,
  'declineRequestWithCooldown'
> = false;
const requestRepoExposesCancel: HasKey<RequestsRepo, 'cancelOutboundRequest'> = false;

const cooldownRepoExposesWrite: HasKey<CooldownRepo, 'setCooldown'> = false;

const facadeExposesCreate: HasKey<FriendshipRepo, 'createRequest'> = false;
const facadeExposesAccept: HasKey<FriendshipRepo, 'acceptRequestBatch'> = false;
const facadeExposesDecline: HasKey<FriendshipRepo, 'declineRequest'> = false;
const facadeExposesDeclineWithCooldown: HasKey<
  FriendshipRepo,
  'declineRequestWithCooldown'
> = false;
const facadeExposesCancel: HasKey<FriendshipRepo, 'cancelOutboundRequest'> = false;
const facadeExposesCooldownWrite: HasKey<FriendshipRepo, 'setCooldown'> = false;

describe('Friendship repositories / backend authority contract', () => {
  it('keeps friend request lifecycle mutations out of RequestsRepo', () => {
    expect(requestRepoExposesCreate).toBe(false);
    expect(requestRepoExposesAccept).toBe(false);
    expect(requestRepoExposesDecline).toBe(false);
    expect(requestRepoExposesDeclineWithCooldown).toBe(false);
    expect(requestRepoExposesCancel).toBe(false);
  });

  it('keeps cooldown mutation out of CooldownRepo', () => {
    expect(cooldownRepoExposesWrite).toBe(false);
  });

  it('keeps every friendship mutation out of the repository facade', () => {
    expect(facadeExposesCreate).toBe(false);
    expect(facadeExposesAccept).toBe(false);
    expect(facadeExposesDecline).toBe(false);
    expect(facadeExposesDeclineWithCooldown).toBe(false);
    expect(facadeExposesCancel).toBe(false);
    expect(facadeExposesCooldownWrite).toBe(false);
  });
});
