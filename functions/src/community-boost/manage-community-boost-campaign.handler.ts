// functions/src/community-boost/manage-community-boost-campaign.handler.ts
// -----------------------------------------------------------------------------
// COMMUNITY BOOST CAMPAIGN MANAGEMENT
// -----------------------------------------------------------------------------

import { HttpsError, onCall } from 'firebase-functions/v2/https';

import { assertRecentAuthentication } from '../account_lifecycle/_shared';
import { FUNCTIONS_REGION } from '../config/functions-region';
import { db } from '../firebaseApp';
import {
  REQUIRE_CALLABLE_APP_CHECK,
  assertCallableAppCheck,
} from '../shared/security/callable-app-check';
import {
  buildCommunityBoostCampaign,
  normalizeCommunityBoostAdvertiserAccount,
  normalizeCommunityBoostBillingConfig,
  normalizeCommunityBoostCampaign,
} from './community-boost.policy';

type CommunityBoostCampaignAction =
  | 'create'
  | 'pause'
  | 'resume'
  | 'cancel';

interface ManageCommunityBoostCampaignRequest {
  readonly requestId?: unknown;
  readonly action?: unknown;
  readonly campaignId?: unknown;
  readonly communityId?: unknown;
  readonly targetTagId?: unknown;
  readonly budgetCents?: unknown;
  readonly dailyBudgetCents?: unknown;
  readonly startsAt?: unknown;
  readonly endsAt?: unknown;
  readonly frequencyCapPerViewerPerDay?: unknown;
}

const SAFE_ID_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;
const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9:_-]{8,128}$/;

function cleanId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_ID_PATTERN.test(normalized) ? normalized : null;
}

function cleanRequestId(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return SAFE_REQUEST_ID_PATTERN.test(normalized) ? normalized : null;
}

function assertActor(
  auth: { uid?: string; token?: Record<string, unknown> } | undefined
): { uid: string; admin: boolean } {
  const uid = String(auth?.uid ?? '').trim();
  if (!uid) throw new HttpsError('unauthenticated', 'Usuário não autenticado.');
  if (auth?.token?.['email_verified'] !== true) {
    throw new HttpsError(
      'failed-precondition',
      'Verifique seu e-mail para continuar.'
    );
  }

  const token = auth.token ?? {};
  const roles = Array.isArray(token['roles']) ? token['roles'] : [];
  return {
    uid,
    admin:
      token['admin'] === true
      || token['role'] === 'admin'
      || roles.includes('admin'),
  };
}

function normalizeAction(value: unknown): CommunityBoostCampaignAction | null {
  return value === 'create'
    || value === 'pause'
    || value === 'resume'
    || value === 'cancel'
    ? value
    : null;
}

function assertCommunityEligible(
  communityId: string,
  rawCommunity: unknown,
  rawMembership: unknown,
  rawDiscovery: unknown,
  actorUid: string,
  admin: boolean
): {
  sourceType: 'community' | 'venue';
  tagIds: readonly string[];
} {
  const community = (rawCommunity ?? {}) as Record<string, unknown>;
  const membership = (rawMembership ?? {}) as Record<string, unknown>;
  const discovery = (rawDiscovery ?? {}) as Record<string, unknown>;
  const source = (discovery['source'] ?? {}) as Record<string, unknown>;
  const sourceType = source['type'];

  if (
    community['status'] !== 'active'
    || ((community['moderation'] ?? {}) as Record<string, unknown>)['state']
      !== 'active'
    || discovery['status'] !== 'active'
    || discovery['moderationState'] !== 'active'
    || discovery['visibility'] !== 'public_preview'
    || (sourceType !== 'community' && sourceType !== 'venue')
  ) {
    throw new HttpsError(
      'failed-precondition',
      'A Comunidade não está elegível para Community Boost.',
      { reason: 'community_boost_target_ineligible' }
    );
  }

  if (!admin) {
    const role = membership['role'];
    const status = membership['status'];
    if (
      status !== 'active'
      || (role !== 'owner' && role !== 'admin')
      || String(membership['uid'] ?? actorUid).trim() !== actorUid
    ) {
      throw new HttpsError(
        'permission-denied',
        'Somente responsáveis pela Comunidade podem gerenciar Community Boost.',
        { reason: 'community_boost_manager_required' }
      );
    }
  }

  if (String(discovery['communityId'] ?? communityId).trim() !== communityId) {
    throw new HttpsError(
      'data-loss',
      'A projeção pública da Comunidade está inconsistente.'
    );
  }

  return {
    sourceType,
    tagIds: Array.isArray(discovery['tagIds'])
      ? discovery['tagIds']
          .map((value) => String(value ?? '').trim())
          .filter(Boolean)
      : [],
  };
}

export const manageCommunityBoostCampaign =
  onCall<ManageCommunityBoostCampaignRequest>(
    {
      region: FUNCTIONS_REGION,
      enforceAppCheck: REQUIRE_CALLABLE_APP_CHECK,
    },
    async (request) => {
      assertCallableAppCheck(request.app);
      const actor = assertActor(request.auth);
      assertRecentAuthentication(request.auth?.token);

      const requestId = cleanRequestId(request.data?.requestId);
      const action = normalizeAction(request.data?.action);

      if (!requestId || !action) {
        throw new HttpsError(
          'invalid-argument',
          'Solicitação de Community Boost inválida.'
        );
      }

      const requestRef = db
        .collection('community_boost_campaign_requests')
        .doc(`${actor.uid}:${requestId}`);
      const now = Date.now();

      if (action === 'create') {
        const communityId = cleanId(request.data?.communityId);
        if (!communityId) {
          throw new HttpsError(
            'invalid-argument',
            'Comunidade inválida para Community Boost.'
          );
        }

        const campaignRef = db.collection('community_boost_campaigns').doc();
        const communityRef = db.collection('communities').doc(communityId);
        const membershipRef = communityRef.collection('members').doc(actor.uid);
        const discoveryRef = db
          .collection('community_discovery_index')
          .doc(communityId);
        const billingConfigRef = db
          .collection('community_boost_billing_config')
          .doc('current');
        const advertiserAccountRef = db
          .collection('community_boost_advertiser_accounts')
          .doc(actor.uid);
        const activeSlotRef = db
          .collection('community_boost_active_slots')
          .doc(communityId);

        return db.runTransaction(async (transaction) => {
          const [
            requestSnapshot,
            communitySnapshot,
            membershipSnapshot,
            discoverySnapshot,
            billingConfigSnapshot,
            advertiserAccountSnapshot,
            activeSlotSnapshot,
          ] = await Promise.all([
            transaction.get(requestRef),
            transaction.get(communityRef),
            transaction.get(membershipRef),
            transaction.get(discoveryRef),
            transaction.get(billingConfigRef),
            transaction.get(advertiserAccountRef),
            transaction.get(activeSlotRef),
          ]);

          if (requestSnapshot.exists) {
            const existing = requestSnapshot.data() ?? {};
            if (
              existing['action'] !== 'create'
              || existing['communityId'] !== communityId
            ) {
              throw new HttpsError(
                'already-exists',
                'O requestId já foi utilizado para outra operação.'
              );
            }

            return {
              campaignId: String(existing['campaignId'] ?? ''),
              status: String(existing['status'] ?? 'active'),
              created: false,
            };
          }

          if (!communitySnapshot.exists || !discoverySnapshot.exists) {
            throw new HttpsError('not-found', 'Comunidade não encontrada.');
          }

          if (activeSlotSnapshot.exists) {
            const activeSlot = activeSlotSnapshot.data() ?? {};
            const slotCampaignId = cleanId(activeSlot['campaignId']);
            const slotEndsAt = Math.trunc(Number(activeSlot['endsAt']));
            const slotStatus = activeSlot['status'];
            const slotStillOpen =
              (slotStatus === 'active' || slotStatus === 'paused')
              && Number.isFinite(slotEndsAt)
              && slotEndsAt > now;

            if (slotCampaignId && slotStillOpen) {
              throw new HttpsError(
                'resource-exhausted',
                'Esta Comunidade já possui uma campanha patrocinada aberta.',
                {
                  reason: 'community_boost_campaign_already_open',
                  campaignId: slotCampaignId,
                }
              );
            }
          }

          const target = assertCommunityEligible(
            communityId,
            communitySnapshot.data(),
            membershipSnapshot.exists ? membershipSnapshot.data() : null,
            discoverySnapshot.data(),
            actor.uid,
            actor.admin
          );
          const billingConfig = normalizeCommunityBoostBillingConfig(
            billingConfigSnapshot.exists ? billingConfigSnapshot.data() : null
          );
          const advertiserAccount =
            normalizeCommunityBoostAdvertiserAccount(
              advertiserAccountSnapshot.exists
                ? advertiserAccountSnapshot.data()
                : null,
              actor.uid
            );

          if (!billingConfig) {
            throw new HttpsError(
              'failed-precondition',
              'Community Boost ainda não possui configuração comercial ativa.',
              { reason: 'community_boost_billing_config_required' }
            );
          }

          if (!advertiserAccount) {
            throw new HttpsError(
              'failed-precondition',
              'Sua conta ainda não está elegível para faturamento de Community Boost.',
              { reason: 'community_boost_advertiser_eligibility_required' }
            );
          }

          const targetTagId = String(request.data?.targetTagId ?? '').trim()
            || null;
          if (
            target.sourceType === 'venue'
            && targetTagId !== null
          ) {
            throw new HttpsError(
              'invalid-argument',
              'Segmentação por interesse não se aplica a Espaço Oficial.'
            );
          }
          if (
            targetTagId !== null
            && !target.tagIds.includes(targetTagId)
          ) {
            throw new HttpsError(
              'invalid-argument',
              'O interesse selecionado não pertence à Comunidade.'
            );
          }

          const requestedBudgetCents = Math.trunc(
            Number(request.data?.budgetCents)
          );
          if (
            !Number.isFinite(requestedBudgetCents)
            || requestedBudgetCents <= 0
            || requestedBudgetCents
              > advertiserAccount.maxCampaignBudgetCents
          ) {
            throw new HttpsError(
              'failed-precondition',
              'O orçamento excede a elegibilidade desta conta anunciante.',
              {
                reason: 'community_boost_budget_not_eligible',
                maxCampaignBudgetCents:
                  advertiserAccount.maxCampaignBudgetCents,
              }
            );
          }

          const campaign = buildCommunityBoostCampaign({
            campaignId: campaignRef.id,
            communityId,
            ownerUid: actor.uid,
            targetSourceType: target.sourceType,
            targetTagId,
            budgetCents: requestedBudgetCents,
            dailyBudgetCents: request.data?.dailyBudgetCents,
            startsAt: request.data?.startsAt,
            endsAt: request.data?.endsAt,
            frequencyCapPerViewerPerDay:
              request.data?.frequencyCapPerViewerPerDay,
            billingConfig,
            now,
          });

          if (!campaign) {
            throw new HttpsError(
              'invalid-argument',
              'Revise orçamento, período e frequency cap da campanha.'
            );
          }

          transaction.create(campaignRef, campaign);
          transaction.set(activeSlotRef, {
            campaignId: campaignRef.id,
            communityId,
            status: campaign.status,
            startsAt: campaign.startsAt,
            endsAt: campaign.endsAt,
            expiresAt: campaign.endsAt + 7 * 24 * 60 * 60 * 1_000,
            updatedAt: now,
          }, { merge: false });
          transaction.create(requestRef, {
            requestId,
            action,
            actorUid: actor.uid,
            campaignId: campaignRef.id,
            communityId,
            status: campaign.status,
            expiresAt: now + 7 * 24 * 60 * 60 * 1_000,
            createdAt: now,
          });
          transaction.create(
            db.collection('community_boost_audit').doc(),
            {
              action: 'community_boost_campaign_created',
              campaignId: campaignRef.id,
              communityId,
              actorUid: actor.uid,
              budgetCents: campaign.budgetCents,
              dailyBudgetCents: campaign.dailyBudgetCents,
              billingConfigVersion: campaign.billingConfigVersion,
              advertiserEligibilityPolicyVersion:
                advertiserAccount.policyVersion,
              advertiserMaxCampaignBudgetCents:
                advertiserAccount.maxCampaignBudgetCents,
              rateCpmCentsSnapshot: campaign.rateCpmCentsSnapshot,
              startsAt: campaign.startsAt,
              endsAt: campaign.endsAt,
              frequencyCapPerViewerPerDay:
                campaign.frequencyCapPerViewerPerDay,
              createdAt: now,
            }
          );

          return {
            campaignId: campaignRef.id,
            status: campaign.status,
            created: true,
          };
        });
      }

      const campaignId = cleanId(request.data?.campaignId);
      if (!campaignId) {
        throw new HttpsError(
          'invalid-argument',
          'Campanha de Community Boost inválida.'
        );
      }

      const campaignRef = db
        .collection('community_boost_campaigns')
        .doc(campaignId);

      return db.runTransaction(async (transaction) => {
        const [requestSnapshot, campaignSnapshot] = await Promise.all([
          transaction.get(requestRef),
          transaction.get(campaignRef),
        ]);

        if (requestSnapshot.exists) {
          const existing = requestSnapshot.data() ?? {};
          if (
            existing['action'] !== action
            || existing['campaignId'] !== campaignId
          ) {
            throw new HttpsError(
              'already-exists',
              'O requestId já foi utilizado para outra operação.'
            );
          }

          return {
            campaignId,
            status: String(existing['status'] ?? ''),
            created: false,
          };
        }

        const campaign = campaignSnapshot.exists
          ? normalizeCommunityBoostCampaign(campaignSnapshot.data())
          : null;
        if (!campaign) {
          throw new HttpsError('not-found', 'Campanha não encontrada.');
        }

        if (!actor.admin && campaign.ownerUid !== actor.uid) {
          throw new HttpsError(
            'permission-denied',
            'Você não pode gerenciar esta campanha.',
            { reason: 'community_boost_manager_required' }
          );
        }

        const activeSlotRef = db
          .collection('community_boost_active_slots')
          .doc(campaign.communityId);
        const activeSlotSnapshot = await transaction.get(activeSlotRef);
        const activeSlot = activeSlotSnapshot.exists
          ? activeSlotSnapshot.data() ?? {}
          : {};
        const slotBelongsToCampaign =
          activeSlot['campaignId'] === campaign.campaignId;

        if (action === 'resume') {
          const advertiserAccountSnapshot = await transaction.get(
            db
              .collection('community_boost_advertiser_accounts')
              .doc(campaign.ownerUid)
          );
          const advertiserAccount =
            normalizeCommunityBoostAdvertiserAccount(
              advertiserAccountSnapshot.exists
                ? advertiserAccountSnapshot.data()
                : null,
              campaign.ownerUid
            );

          if (
            !advertiserAccount
            || campaign.budgetCents
              > advertiserAccount.maxCampaignBudgetCents
          ) {
            throw new HttpsError(
              'failed-precondition',
              'A conta anunciante não está elegível para retomar esta campanha.',
              { reason: 'community_boost_advertiser_eligibility_required' }
            );
          }

          if (
            activeSlotSnapshot.exists
            && !slotBelongsToCampaign
            && Number(activeSlot['endsAt']) > now
          ) {
            throw new HttpsError(
              'resource-exhausted',
              'Outra campanha patrocinada está aberta para esta Comunidade.',
              { reason: 'community_boost_campaign_already_open' }
            );
          }
        }

        let nextStatus = campaign.status;
        if (action === 'pause') {
          if (campaign.status !== 'active') {
            throw new HttpsError(
              'failed-precondition',
              'Somente campanhas ativas podem ser pausadas.'
            );
          }
          nextStatus = 'paused';
        } else if (action === 'resume') {
          if (
            campaign.status !== 'paused'
            || now >= campaign.endsAt
            || campaign.spentMilliCents
              + campaign.rateCpmCentsSnapshot
              > campaign.budgetCents * 1_000
          ) {
            throw new HttpsError(
              'failed-precondition',
              'A campanha não pode ser retomada no estado atual.'
            );
          }
          nextStatus = 'active';
        } else {
          if (
            campaign.status === 'completed'
            || campaign.status === 'canceled'
          ) {
            throw new HttpsError(
              'failed-precondition',
              'A campanha já foi encerrada.'
            );
          }
          nextStatus = 'canceled';
        }

        transaction.update(campaignRef, {
          status: nextStatus,
          updatedAt: now,
        });

        if (nextStatus === 'canceled') {
          if (slotBelongsToCampaign) {
            transaction.delete(activeSlotRef);
          }
        } else {
          transaction.set(activeSlotRef, {
            campaignId: campaign.campaignId,
            communityId: campaign.communityId,
            status: nextStatus,
            startsAt: campaign.startsAt,
            endsAt: campaign.endsAt,
            expiresAt: campaign.endsAt + 7 * 24 * 60 * 60 * 1_000,
            updatedAt: now,
          }, { merge: false });
        }

        transaction.create(requestRef, {
          requestId,
          action,
          actorUid: actor.uid,
          campaignId,
          status: nextStatus,
          expiresAt: now + 7 * 24 * 60 * 60 * 1_000,
          createdAt: now,
        });
        transaction.create(
          db.collection('community_boost_audit').doc(),
          {
            action: `community_boost_campaign_${action}`,
            campaignId,
            communityId: campaign.communityId,
            actorUid: actor.uid,
            previousStatus: campaign.status,
            nextStatus,
            createdAt: now,
          }
        );

        return {
          campaignId,
          status: nextStatus,
          created: false,
        };
      });
    }
  );
