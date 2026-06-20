// functions/src/discovery/profile-discovery-normalization.ts
// -----------------------------------------------------------------------------
// PROFILE DISCOVERY NORMALIZATION
// -----------------------------------------------------------------------------
// Normalização canônica de gênero/orientação/interesses para descoberta.
//
// Esta camada roda no backend e deve ser a fonte confiável para futuros índices,
// filtros e elegibilidade de descoberta. Não decide UI e não consulta Firestore.
// -----------------------------------------------------------------------------

export type NormalizedDiscoveryGender =
  | "man"
  | "woman"
  | "couple"
  | "unknown";

export type NormalizedDiscoveryOrientation =
  | "heterosexual"
  | "homosexual"
  | "bisexual"
  | "pansexual"
  | "unknown";

export interface CanonicalProfileDiscoveryFields {
  normalizedGender: NormalizedDiscoveryGender;
  normalizedOrientation: NormalizedDiscoveryOrientation;
  interestedInGenders: readonly NormalizedDiscoveryGender[];
  interestedInOrientations: readonly NormalizedDiscoveryOrientation[];
  compatibilityReady: boolean;
}

interface ProfileDiscoverySource {
  gender?: unknown;
  genero?: unknown;
  orientation?: unknown;
  sexualOrientation?: unknown;
  orientacao?: unknown;
  orientacaoSexual?: unknown;
  preferences?: unknown;
  preferencias?: unknown;
  interestedInGenders?: unknown;
  generosDeInteresse?: unknown;
  interestedInOrientations?: unknown;
  orientacoesDeInteresse?: unknown;
}

function normalizeText(value: unknown): string {
  return typeof value === "string"
    ? value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    : "";
}

function unique<T>(values: readonly T[]): readonly T[] {
  return Array.from(new Set(values));
}

function asArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

export function normalizeDiscoveryGender(value: unknown): NormalizedDiscoveryGender {
  const text = normalizeText(value).replace(/_/g, "-");

  if (
    text === "homem" ||
    text === "homens" ||
    text === "masculino" ||
    text === "male" ||
    text === "man" ||
    text === "men"
  ) {
    return "man";
  }

  if (
    text === "mulher" ||
    text === "mulheres" ||
    text === "feminino" ||
    text === "female" ||
    text === "woman" ||
    text === "women"
  ) {
    return "woman";
  }

  if (
    text === "casal" ||
    text === "casais" ||
    text === "couple" ||
    text === "couples" ||
    text === "dupla" ||
    text === "casal-ele-ele" ||
    text === "casal-ele-ela" ||
    text === "casal-ela-ela"
  ) {
    return "couple";
  }

  return "unknown";
}

export function normalizeDiscoveryOrientation(
  value: unknown
): NormalizedDiscoveryOrientation {
  const text = normalizeText(value);

  if (
    text === "heterossexual" ||
    text === "heterosexual" ||
    text === "hetero" ||
    text === "heteros" ||
    text === "straight"
  ) {
    return "heterosexual";
  }

  if (
    text === "homossexual" ||
    text === "homosexual" ||
    text === "homo" ||
    text === "gay" ||
    text === "lesbica" ||
    text === "lesbian"
  ) {
    return "homosexual";
  }

  if (
    text === "bissexual" ||
    text === "bisexual" ||
    text === "bi"
  ) {
    return "bisexual";
  }

  if (
    text === "pansexual" ||
    text === "pan"
  ) {
    return "pansexual";
  }

  return "unknown";
}

function gendersFromFreeText(value: unknown): NormalizedDiscoveryGender[] {
  const text = normalizeText(value).replace(/_/g, "-");
  const genders: NormalizedDiscoveryGender[] = [];

  if (
    /\bhomem\b/.test(text) ||
    /\bhomens\b/.test(text) ||
    /\bmasculino\b/.test(text) ||
    /\bmale\b/.test(text) ||
    /\bmen\b/.test(text)
  ) {
    genders.push("man");
  }

  if (
    /\bmulher\b/.test(text) ||
    /\bmulheres\b/.test(text) ||
    /\bfeminino\b/.test(text) ||
    /\bfemale\b/.test(text) ||
    /\bwomen\b/.test(text)
  ) {
    genders.push("woman");
  }

  if (
    /\bcasal\b/.test(text) ||
    /\bcasais\b/.test(text) ||
    /\bcouple\b/.test(text) ||
    /\bcouples\b/.test(text) ||
    /\bdupla\b/.test(text) ||
    /\bcasal-ele-ele\b/.test(text) ||
    /\bcasal-ele-ela\b/.test(text) ||
    /\bcasal-ela-ela\b/.test(text)
  ) {
    genders.push("couple");
  }

  return genders;
}

function orientationsFromFreeText(value: unknown): NormalizedDiscoveryOrientation[] {
  const text = normalizeText(value);
  const orientations: NormalizedDiscoveryOrientation[] = [];

  if (
    /\bhetero\b/.test(text) ||
    /\bheteros\b/.test(text) ||
    /\bheterossexual\b/.test(text) ||
    /\bheterosexual\b/.test(text) ||
    /\bstraight\b/.test(text)
  ) {
    orientations.push("heterosexual");
  }

  if (
    /\bhomo\b/.test(text) ||
    /\bhomossexual\b/.test(text) ||
    /\bhomosexual\b/.test(text) ||
    /\bgay\b/.test(text) ||
    /\blesbica\b/.test(text) ||
    /\blesbian\b/.test(text)
  ) {
    orientations.push("homosexual");
  }

  if (
    /\bbi\b/.test(text) ||
    /\bbissexual\b/.test(text) ||
    /\bbisexual\b/.test(text)
  ) {
    orientations.push("bisexual");
  }

  if (
    /\bpan\b/.test(text) ||
    /\bpansexual\b/.test(text)
  ) {
    orientations.push("pansexual");
  }

  return orientations;
}

function normalizeGenderList(values: unknown): readonly NormalizedDiscoveryGender[] {
  return unique(
    asArray(values)
      .flatMap((value) => {
        const direct = normalizeDiscoveryGender(value);

        return direct !== "unknown" ? [direct] : gendersFromFreeText(value);
      })
      .filter((value): value is NormalizedDiscoveryGender => value !== "unknown")
  );
}

function normalizeOrientationList(
  values: unknown
): readonly NormalizedDiscoveryOrientation[] {
  return unique(
    asArray(values)
      .flatMap((value) => {
        const direct = normalizeDiscoveryOrientation(value);

        return direct !== "unknown" ? [direct] : orientationsFromFreeText(value);
      })
      .filter((value): value is NormalizedDiscoveryOrientation => value !== "unknown")
  );
}

function acceptedTargetGendersByOrientation(
  selfGender: NormalizedDiscoveryGender,
  selfOrientation: NormalizedDiscoveryOrientation
): readonly NormalizedDiscoveryGender[] {
  if (selfOrientation === "bisexual" || selfOrientation === "pansexual") {
    return ["man", "woman", "couple"];
  }

  if (selfGender === "man" && selfOrientation === "heterosexual") {
    return ["woman"];
  }

  if (selfGender === "woman" && selfOrientation === "heterosexual") {
    return ["man"];
  }

  if (selfGender === "man" && selfOrientation === "homosexual") {
    return ["man"];
  }

  if (selfGender === "woman" && selfOrientation === "homosexual") {
    return ["woman"];
  }

  if (selfGender === "couple") {
    return ["man", "woman", "couple"];
  }

  return [];
}

export function normalizeProfileDiscoveryFields(
  source: ProfileDiscoverySource | null | undefined
): CanonicalProfileDiscoveryFields {
  const normalizedGender = normalizeDiscoveryGender(source?.gender ?? source?.genero);
  const normalizedOrientation = normalizeDiscoveryOrientation(
    source?.orientation ??
      source?.sexualOrientation ??
      source?.orientacao ??
      source?.orientacaoSexual
  );

  const explicitGenders = normalizeGenderList(
    source?.interestedInGenders ?? source?.generosDeInteresse
  );
  const preferenceGenders = normalizeGenderList(source?.preferences ?? source?.preferencias);
  const fallbackGenders = acceptedTargetGendersByOrientation(
    normalizedGender,
    normalizedOrientation
  );

  const explicitOrientations = normalizeOrientationList(
    source?.interestedInOrientations ?? source?.orientacoesDeInteresse
  );
  const preferenceOrientations = normalizeOrientationList(source?.preferences ?? source?.preferencias);

  const interestedInGenders = explicitGenders.length
    ? explicitGenders
    : preferenceGenders.length
      ? preferenceGenders
      : fallbackGenders;

  const interestedInOrientations = explicitOrientations.length
    ? explicitOrientations
    : preferenceOrientations;

  return {
    normalizedGender,
    normalizedOrientation,
    interestedInGenders,
    interestedInOrientations,
    compatibilityReady:
      normalizedGender !== "unknown" &&
      normalizedOrientation !== "unknown" &&
      interestedInGenders.length > 0,
  };
}
