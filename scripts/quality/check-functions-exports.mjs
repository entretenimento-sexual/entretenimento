// scripts/quality/check-functions-exports.mjs
// -----------------------------------------------------------------------------
// Verifica o artefato compilado que o Firebase Emulator realmente carrega.
//
// Objetivo:
// - impedir que um barrel TypeScript correto esconda um functions/lib obsoleto;
// - falhar antes de iniciar emuladores ou validar produção;
// - manter diagnóstico explícito para callables críticas de mensageria, compliance
//   e superfícies comunitárias em desenvolvimento.
// -----------------------------------------------------------------------------
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const entryPath = resolve(process.cwd(), 'functions', 'lib', 'index.js');
const temporaryCompatibilityExports = [
  // Cliente publicado antes da paginação administrativa. Remover somente em
  // release pós-estabilização, após telemetria confirmar ausência de chamadas.
  'getCommunityOwnershipCandidates',

  // Clientes antigos de mídia ainda podem chamar estes nomes. Os endpoints de
  // unpublish são fail-closed e a normalização é migração idempotente. Manter
  // explicitamente até a janela de compatibilidade ser encerrada por telemetria.
  'unpublishPhoto',
  'unpublishVideo',
  'normalizeLegacyVideoModeration',
];

const expectedDeploymentExports = [
  'acceptAdultConsent',
  'acceptAdultSelfDeclaration',
  'acceptCommunityInvite',
  'acceptFriendRequest',
  'acceptPlatformTerms',
  'acceptRoomInvite',
  'appealProfileAgeReverification',
  'archiveCommunity',
  'auditUserPrivilegeChanges',
  'backfillPublicProfileDiscovery',
  'blockUser',
  'cancelAccountDeletion',
  'cancelFriendRequest',
  'cancelPlatformSubscriptionDowngrade',
  'cancelPlatformSubscriptionRenewal',
  'cleanupCancelledVideoProcessing',
  'cleanupExpiredPhotoUploadReservations',
  'cleanupFailedVideoUploads',
  'cleanupPendingPhotoDeletions',
  'cleanupPendingPrivateVideoUploadAssets',
  'cleanupPendingPublishedPhotoAssets',
  'cleanupPendingPublishedVideoAssets',
  'cleanupPendingVideoDeletions',
  'cleanupRetriedVideoProcessingOutputs',
  'cleanupUnpublishedVideoInteractions',
  'cleanupVideoRotationInput',
  'clearStalePresence',
  'closePrivateRoom',
  'configureCommunityRankingMode',
  'createCommunity',
  'createCommunityFeedComment',
  'createCommunityFeedCommentReply',
  'createCommunityFeedPost',
  'createCommunityTopic',
  'createCommunityTopicReply',
  'createOfficialCommunity',
  'createPhotoComment',
  'createPlatformCheckoutSession',
  'createPrivateRoom',
  'createVenueCommunity',
  'createVideoComment',
  'declineCommunityInvite',
  'declineFriendRequest',
  'declineRoomInvite',
  'deleteDirectMessage',
  'deleteProfilePhoto',
  'deleteProfileVideo',
  'discardFailedVideoUpload',
  'endFriendship',
  'ensureCurrentLegalNotice',
  'ensureDirectChat',
  'expireAgeEligibilityAtBoundary',
  'expireAgeEligibilityRecords',
  'findCommunityInviteCandidate',
  'getAccountDeletionOperations',
  'getAuthorizedPhotoOwnerPage',
  'getCommunityAdminTimeline',
  'getCommunityBoostCampaignDashboard',
  'getCommunityBoostPlacement',
  'getCommunityCreationCapability',
  'getCommunityDiscoveryPage',
  'getCommunityExploreContent',
  'getCommunityFeedCommentRepliesPage',
  'getCommunityFeedCommentsPage',
  'getCommunityFeedItems',
  'getCommunityFeedPage',
  'getCommunityHighlight',
  'getCommunityInvites',
  'getCommunityMemberRosterPage',
  'getCommunityMembersForManagement',
  'getCommunityMembershipContext',
  'getCommunityMembershipProfileVisibility',
  'getCommunityMembershipRequests',
  'getCommunityOfficialClaimCapability',
  'getCommunityOfficialClaimReviewQueue',
  'getCommunityOwnershipCandidates',
  'getCommunityOwnershipCandidatesPage',
  'getCommunityPreview',
  'getCommunitySentInvites',
  'getCommunityTagCatalog',
  'getCommunityTopicDetail',
  'getCommunityTopicRepliesPage',
  'getCommunityTopicsPage',
  'getMyAccountPrivilegeHistory',
  'getMyBillingSnapshot',
  'getMyCommunitiesPage',
  'getMyCommunityActivityCards',
  'getMyCommunityOfficialClaim',
  'getMyComplianceCases',
  'getMyExclusiveConnectionsPage',
  'getMyPlatformSubscriptionHistory',
  'getOfficialCommunitiesForTarget',
  'getPendingFriendRequests',
  'getPlatformPlanByKey',
  'getPlatformPlans',
  'getPrivateVideoAccessUrls',
  'getProfileOfficialCommunities',
  'getProfilePublicCommunities',
  'getPublicMediaDiscovery',
  'getPublicPhotoAccessUrls',
  'getPublicProfilesPage',
  'getPublicVideoAccessUrls',
  'getRecentPublicMediaViews',
  'getUserIntentStatuses',
  'getVideoProcessingOperationalStatus',
  'hideUserIntentStatus',
  'initializePublicAgeEligibilityProjection',
  'inspectCommunityPurgeReadiness',
  'inspectCommunityRankingReadiness',
  'issueEventAuthority',
  'issueSuspectedViolationNotice',
  'leaveCommunityMembership',
  'listVideoProcessingRecoveryJobs',
  'manageBusinessOfficialEntitlement',
  'manageCommunityBoostAdvertiserAccount',
  'manageCommunityBoostBillingConfig',
  'manageCommunityBoostCampaign',
  'manageCommunityHighlight',
  'manageCommunityMember',
  'markAllNotificationsRead',
  'markNotificationRead',
  'moderateCommunityFeedComment',
  'moderateCommunityFeedCommentReply',
  'moderateCommunityFeedPost',
  'moderateCommunityTopic',
  'moderatePhotoComment',
  'moderateScheduleDeletion',
  'moderateSuspendAccount',
  'moderateUnsuspendAccount',
  'moderateVideoComment',
  'normalizeLegacyVideoModeration',
  'onUserCreate',
  'onUserCreateIndexNickname',
  'paymentWebhook',
  'processAgeVerificationProviderAssertion',
  'processBillingReturn',
  'processProviderWebhookEventTrigger',
  'publishPhoto',
  'publishUserIntentStatus',
  'publishVideo',
  'publishVideoWhenReady',
  'purgeDeletedAccounts',
  'queueHighRiskModerationLegalReview',
  'queuePrivateVideoProcessing',
  'rateVideo',
  'reactivateSelfSuspension',
  'reconcileAccountLifecycleBilling',
  'reconcileCommunityMemberCounts',
  'reconcileCommunityMembershipNotificationsTrigger',
  'reconcileModerationSuspensions',
  'reconcilePlatformSubscriptions',
  'reconcileProviderWebhookEvents',
  'reconcileRecurringProviderCancellations',
  'reconcileRecurringProviderPlanChanges',
  'reconcileVideoProcessing',
  'recordCommunityBoostEvent',
  'recordCommunityDiscoveryExposure',
  'recordCommunityDistributionEvents',
  'recordPhotoView',
  'recordVideoRetention',
  'recordVideoView',
  'recoverRegistrationSeed',
  'recoverVideoProcessingJob',
  'reservePhotoUpload',
  'refreshMyAgeEligibility',
  'registerPrivateVideoUpload',
  'registerPushDevice',
  'reportCommunityFeedComment',
  'reportCommunityFeedCommentReply',
  'reportCommunityFeedPost',
  'reportPhotoContent',
  'reportProfileMinorSafety',
  'reportVideoContent',
  'requestAccountDeletion',
  'requestCommunityMembership',
  'requestInitialAgeVerificationReview',
  'requestProfileAgeReverification',
  'requestSelfSuspension',
  'retryPendingModerationEvidencePreservation',
  'reviewCommunityFeedCommentReplyReport',
  'reviewCommunityFeedCommentReport',
  'reviewCommunityFeedPostReport',
  'reviewCommunityMembership',
  'reviewCommunityOfficialClaim',
  'reviewInitialAgeVerification',
  'reviewPhotoContentReport',
  'reviewProfileAgeReverification',
  'reviewProfileMinorSafetyReport',
  'reviewVideoContentReport',
  'revokeCommunityInvite',
  'revokeEventAuthority',
  'runCommunityBoostLifecycle',
  'runCommunityDiscoveryExposureRetention',
  'runCommunityExploreContentRetention',
  'runCommunityLifecycle',
  'runCommunityOfficialAssociationLifecycle',
  'runCommunityPurge',
  'runCommunityRanking',
  'scheduleAgeEligibilityExpirationTask',
  'schedulePlatformSubscriptionDowngrade',
  'searchCommunityMembersPage',
  'sendCommunityInvite',
  'sendDirectMessage',
  'sendDirectVideoReference',
  'sendFriendRequest',
  'sendNotification',
  'sendRoomInvite',
  'setCoverPhoto',
  'startPublicVideoPlaybackSession',
  'submitCommunityOfficialClaim',
  'submitComplianceCaseResponse',
  'submitProfileAgeReverification',
  'submitQueuedVideoProcessing',
  'syncAccountLifecycleSubscriptionProjection',
  'syncCommunityAdminTimelineFeedAudit',
  'syncCommunityAdminTimelineHighlightAudit',
  'syncCommunityAdminTimelineLifecycleAudit',
  'syncCommunityAdminTimelineMembershipAudit',
  'syncCommunityAdminTimelineOfficialAssociationAudit',
  'syncCommunityAdminTimelineOfficialClaimAudit',
  'syncCommunityAdminTimelineSettingsAudit',
  'syncCommunityAdminTimelineTopicAudit',
  'syncCommunityArchiveProjections',
  'syncCommunityCapacityRegularization',
  'syncCommunityFeedActivity',
  'syncCommunityFeedRealtimeTrigger',
  'syncCommunityHighlightCommunityTrigger',
  'syncCommunityHighlightTarget',
  'syncCommunityMemberManagementIndex',
  'syncCommunityMemberManagementIndexFromUser',
  'syncCommunityMemberSearchIndex',
  'syncCommunityMemberSearchIndexFromPublicProfile',
  'syncCommunityMembershipActivity',
  'syncCommunityNotificationSummaryTrigger',
  'syncCommunityOfficialAssociation',
  'syncCommunityOfficialAssociationLifecycle',
  'syncCommunityProfileMembershipIndexTrigger',
  'syncCommunityRankingFromCommunity',
  'syncCommunityRankingFromDiscovery',
  'syncCommunityUserIndex',
  'syncPlatformSubscriptionEntitlement',
  'syncPublicAgeEligibilityProjection',
  'syncPublicPreferenceProjectionTrigger',
  'syncPublicProfileDiscovery',
  'syncPublishedPhotoOnPrivateUpdate',
  'syncPublishedVideoSettings',
  'syncVenuePublicLocation',
  'toggleCommunityFeedReaction',
  'togglePhotoReaction',
  'toggleVideoReaction',
  'transferCommunityOwnership',
  'unblockUser',
  'unpublishPhoto',
  'unpublishVideo',
  'unregisterPushDevice',
  'updateCommunityMembershipDisclosurePolicy',
  'updateCommunityMembershipProfileVisibility',
  'updateCommunityNotificationPreference',
  'updateCommunitySettings',
  'updateVideoPublicationSettings',
];

const requiredExports = [
  'syncAccountLifecycleSubscriptionProjection',
  'reconcileAccountLifecycleBilling',
  'reconcileModerationSuspensions',
  'reconcileRecurringProviderCancellations',
  'reconcileRecurringProviderPlanChanges',
  'reconcileProviderWebhookEvents',
  'processProviderWebhookEventTrigger',
  'cancelPlatformSubscriptionRenewal',
  'schedulePlatformSubscriptionDowngrade',
  'cancelPlatformSubscriptionDowngrade',
  'paymentWebhook',
  'createPrivateRoom',
  'closePrivateRoom',
  'sendRoomInvite',
  'acceptRoomInvite',
  'declineRoomInvite',
  'ensureDirectChat',
  'sendDirectMessage',
  'deleteDirectMessage',
  'acceptPlatformTerms',
  'acceptAdultSelfDeclaration',
  'acceptAdultConsent',
  'refreshMyAgeEligibility',
  'requestInitialAgeVerificationReview',
  'reviewInitialAgeVerification',
  'ensureCurrentLegalNotice',
  'issueSuspectedViolationNotice',
  'getMyComplianceCases',
  'submitComplianceCaseResponse',
  'getMyBillingSnapshot',
  'getPlatformPlans',
  'getPublicVideoAccessUrls',
  'getRecentPublicMediaViews',
  'createCommunity',
  'getCommunityCreationCapability',
  'getCommunityTagCatalog',
  'createCommunityFeedPost',
  'getCommunityFeedItems',
  'createCommunityFeedComment',
  'createCommunityFeedCommentReply',
  'getCommunityFeedCommentsPage',
  'getCommunityFeedCommentRepliesPage',
  'moderateCommunityFeedComment',
  'moderateCommunityFeedCommentReply',
  'toggleCommunityFeedReaction',
  'moderateCommunityFeedPost',
  'reportCommunityFeedPost',
  'reportCommunityFeedComment',
  'reportCommunityFeedCommentReply',
  'reviewCommunityFeedPostReport',
  'reviewCommunityFeedCommentReport',
  'reviewCommunityFeedCommentReplyReport',
  'getCommunityTopicsPage',
  'getCommunityTopicDetail',
  'getCommunityTopicRepliesPage',
  'createCommunityTopic',
  'createCommunityTopicReply',
  'moderateCommunityTopic',
  'getCommunityMembersForManagement',
  'getCommunityOwnershipCandidatesPage',
  ...temporaryCompatibilityExports,
  'manageCommunityMember',
  'syncCommunityMemberManagementIndex',
  'syncCommunityMemberManagementIndexFromUser',
  'syncCommunityArchiveProjections',
  'syncCommunityFeedRealtimeTrigger',
  'reconcileCommunityMembershipNotificationsTrigger',
  'syncCommunityProfileMembershipIndexTrigger',
  'syncCommunityHighlightCommunityTrigger',
  'syncPublicPreferenceProjectionTrigger',
  'syncCommunityNotificationSummaryTrigger',
];

if (!existsSync(entryPath)) {
  console.error(
    '[functions:exports] functions/lib/index.js não existe. Execute npm run functions:build.'
  );
  process.exit(1);
}

const require = createRequire(import.meta.url);
let compiledFunctions;

try {
  compiledFunctions = require(entryPath);
} catch (error) {
  console.error(
    `[functions:exports] Não foi possível carregar ${pathToFileURL(entryPath).href}.`
  );
  console.error(error);
  process.exit(1);
}

const forbiddenLegacyTriggerExports = [
  'syncCommunityFeedRealtime',
  'reconcileCommunityMembershipNotifications',
  'syncCommunityProfileMembershipIndex',
  'syncCommunityHighlightCommunity',
  'syncPublicPreferenceProjection',
  'syncCommunityNotificationSummary',
];

const missingExports = requiredExports.filter(
  (exportName) => typeof compiledFunctions?.[exportName] !== 'function'
);

const leakedLegacyTriggerExports = forbiddenLegacyTriggerExports.filter(
  (exportName) => typeof compiledFunctions?.[exportName] === 'function'
);

function isFirebaseDeploymentExport(value) {
  if (typeof value !== 'function') {
    return false;
  }

  // Não leia __endpoint/__trigger aqui. Em Functions v1 alguns desses campos
  // são getters que materializam metadata e exigem GCLOUD_PROJECT. O auditor
  // só precisa saber se a marca de deployment existe; o operador "in" verifica
  // a propriedade sem executar o getter, mantendo o check independente do
  // ambiente local/CI.
  return '__endpoint' in value || '__trigger' in value;
}

const deploymentExports = Object.entries(compiledFunctions ?? {})
  .filter(([, value]) => isFirebaseDeploymentExport(value))
  .map(([exportName]) => exportName)
  .sort();

const expectedDeploymentExportSet = new Set(
  expectedDeploymentExports
);
const missingDeploymentExports = expectedDeploymentExports.filter(
  (exportName) => !deploymentExports.includes(exportName)
);
const unexpectedDeploymentExports = deploymentExports.filter(
  (exportName) => !expectedDeploymentExportSet.has(exportName)
);

if (leakedLegacyTriggerExports.length > 0) {
  console.error(
    '[functions:exports] Exports legados de trigger não podem voltar ao root:'
  );
  for (const exportName of leakedLegacyTriggerExports) {
    console.error(`- ${exportName}`);
  }
  process.exit(1);
}

if (
  missingDeploymentExports.length > 0
  || unexpectedDeploymentExports.length > 0
) {
  if (missingDeploymentExports.length > 0) {
    console.error(
      '[functions:exports] Deployment exports esperados ausentes:'
    );
    for (const exportName of missingDeploymentExports) {
      console.error(`- ${exportName}`);
    }
  }

  if (unexpectedDeploymentExports.length > 0) {
    console.error(
      '[functions:exports] Deployment exports inesperados fora da allowlist:'
    );
    for (const exportName of unexpectedDeploymentExports) {
      console.error(`- ${exportName}`);
    }
  }

  console.error(
    '[functions:exports] Atualize a allowlist somente após classificar explicitamente a mudança de superfície pública.'
  );
  process.exit(1);
}

if (missingExports.length > 0) {
  console.error('[functions:exports] Exports públicos ausentes no artefato compilado:');
  for (const exportName of missingExports) {
    console.error(`- ${exportName}`);
  }
  console.error(
    '[functions:exports] O emulador não deve iniciar com Functions desatualizadas.'
  );
  process.exit(1);
}

console.log(
  `[functions:exports] OK: ${requiredExports.join(', ')}`
);
console.log(
  `[functions:exports] Compatibilidade temporária preservada: ${temporaryCompatibilityExports.join(', ')}`
);

console.log(
  `[functions:exports] Deployment exports detectados: ${deploymentExports.join(', ')}`
);
console.log(
  `[functions:exports] Superfície implantável exata validada: ${deploymentExports.length} export(s).`
);
