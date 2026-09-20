// functions/src/community/community-business-official-calibration.policy.ts
// -----------------------------------------------------------------------------
// BUSINESS / OFFICIAL COMMERCIAL CALIBRATION
// -----------------------------------------------------------------------------
// Esta policy não inventa preço nem capacidade. Ela transforma observações reais
// da oferta Business/Official em indicadores objetivos que podem embasar uma
// alteração posterior da configuração comercial versionada.
//
// Fonte dos sinais:
// - offersPresented / conversions: funil comercial da oferta real;
// - communitiesCreated: estado canônico criado após conversão;
// - actualCostCents: custo financeiro realizado, importado de billing/finanças.
//
// Proxies operacionais (reads/card, writes/exposure etc.) NÃO são custo em moeda.
// -----------------------------------------------------------------------------

export type CommunityBusinessOfficialCalibrationStatus =
  | 'invalid_observation'
  | 'no_supply_observation'
  | 'no_conversion_observation'
  | 'no_creation_observation'
  | 'actual_cost_missing'
  | 'observed';

export interface CommunityBusinessOfficialCalibrationInput {
  readonly offersPresented: unknown;
  readonly conversions: unknown;
  readonly communitiesCreated: unknown;
  readonly actualCostCents: unknown;
}

export interface CommunityBusinessOfficialCalibrationSnapshot {
  readonly offersPresented: number;
  readonly conversions: number;
  readonly communitiesCreated: number;
  readonly actualCostCents: number | null;
  readonly conversionRate: number | null;
  readonly communitiesPerConversion: number | null;
  readonly actualCostPerCreatedCommunityCents: number | null;
  readonly status: CommunityBusinessOfficialCalibrationStatus;
  readonly canCalibrateCommercialOffer: boolean;
}

function normalizeObservedCount(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isFinite(value)
    && Number.isInteger(value)
    && value >= 0
    ? value
    : null;
}

function normalizeActualCostCents(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isFinite(value)
    && Number.isInteger(value)
    && value >= 0
    ? value
    : null;
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Math.round((numerator / denominator) * 10_000) / 10_000;
}

export function evaluateCommunityBusinessOfficialCalibration(
  input: CommunityBusinessOfficialCalibrationInput
): Readonly<CommunityBusinessOfficialCalibrationSnapshot> {
  const offersPresented = normalizeObservedCount(input.offersPresented);
  const conversions = normalizeObservedCount(input.conversions);
  const communitiesCreated = normalizeObservedCount(input.communitiesCreated);
  const actualCostCents = normalizeActualCostCents(input.actualCostCents);

  if (
    offersPresented === null
    || conversions === null
    || communitiesCreated === null
    || conversions > offersPresented
  ) {
    return Object.freeze({
      offersPresented: offersPresented ?? 0,
      conversions: conversions ?? 0,
      communitiesCreated: communitiesCreated ?? 0,
      actualCostCents,
      conversionRate: null,
      communitiesPerConversion: null,
      actualCostPerCreatedCommunityCents: null,
      status: 'invalid_observation',
      canCalibrateCommercialOffer: false,
    });
  }

  const status: CommunityBusinessOfficialCalibrationStatus =
    offersPresented === 0
      ? 'no_supply_observation'
      : conversions === 0
        ? 'no_conversion_observation'
        : communitiesCreated === 0
          ? 'no_creation_observation'
          : actualCostCents === null
            ? 'actual_cost_missing'
            : 'observed';

  return Object.freeze({
    offersPresented,
    conversions,
    communitiesCreated,
    actualCostCents,
    conversionRate: ratio(conversions, offersPresented),
    communitiesPerConversion: ratio(communitiesCreated, conversions),
    actualCostPerCreatedCommunityCents:
      actualCostCents === null
        ? null
        : Math.round((actualCostCents / communitiesCreated) * 100) / 100,
    status,
    canCalibrateCommercialOffer: status === 'observed',
  });
}
