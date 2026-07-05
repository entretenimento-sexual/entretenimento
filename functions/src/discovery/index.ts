// functions/src/discovery/index.ts
// -----------------------------------------------------------------------------
// DISCOVERY DOMAIN EXPORTS
// -----------------------------------------------------------------------------
export {
  publishUserIntentStatus,
  hideUserIntentStatus,
} from './user-intent-status.handler';

export { syncPublicProfileDiscovery } from './sync-public-profile-discovery.handler';

/**
 * Reexport defensivo.
 *
 * Em alguns builds TypeScript, a reexportação nomeada deste handler vinha
 * acusando falso negativo de membro exportado. O export-star mantém o contrato
 * público quando o handler exporta backfillPublicProfileDiscovery e não quebra
 * caso o compilador resolva o módulo antes da inferência nominal.
 */
export * from './backfill-public-profile-discovery.handler';
