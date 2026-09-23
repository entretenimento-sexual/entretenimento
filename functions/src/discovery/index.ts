// functions/src/discovery/index.ts
// -----------------------------------------------------------------------------
// DISCOVERY DOMAIN EXPORTS
// -----------------------------------------------------------------------------
export {
  publishUserIntentStatus,
  hideUserIntentStatus,
} from './user-intent-status.handler';

export { syncPublicProfileDiscovery } from './sync-public-profile-discovery.handler';
// Production still has a legacy HTTPS function under the old export name.
export {
  syncPublicPreferenceProjection as syncPublicPreferenceProjectionTrigger,
} from './sync-public-preference-projection.handler';

/**
 * Reexport defensivo.
 *
 * Em alguns builds TypeScript, a reexportação nomeada deste handler vinha
 * acusando falso negativo de membro exportado. O export-star mantém o contrato
 * público quando o handler exporta backfillPublicProfileDiscovery e não quebra
 * caso o compilador resolva o módulo antes da inferência nominal.
 */
export * from './backfill-public-profile-discovery.handler';

export {
  initializePublicAgeEligibilityProjection,
  syncPublicAgeEligibilityProjection,
} from './public-age-eligibility-projection.handler';

export { getPublicProfilesPage } from './get-public-profiles-page.handler';
