// src/app/core/utils/preferences/preference-mappers.ts
// Mapper de transição entre:
// - legado V1 (flags soltas e/ou arrays por categoria)
// - V2 tipada (IUserPreferenceProfile)
//
// Objetivo:
// - manter a UI atual funcionando sem reescrever o HTML inteiro agora
// - permitir dual-read / dual-write por um período de migração
// - padronizar o shape salvo em V2
// vislumbrando algumas faltas como etnia, tamanho do penis, mais fantasias como mulher de bunda e seios grandes

import { IUserPreferences } from 'src/app/core/interfaces/interfaces-user-dados/iuser-preferences';
import { IUserPreferenceProfile } from '@core/interfaces/preferences/user-preference-profile.interface';
import { createEmptyPreferenceProfile } from './preference-normalizers';
import {
  TBodyType,
  TGenderInterest,
  TPractice,
  TRelationshipIntent,
} from '@core/interfaces/preferences/user-preference-enums';

const genderMap: Record<string, TGenderInterest> = {
  homens: 'homens',
  mulheres: 'mulheres',
  'casais-ele-ele': 'casais_ele_ele',
  'casais-ele-ela': 'casais_ele_ela',
  'casais-ela-ela': 'casais_ela_ela',
  travestis: 'travestis',
  travesti: 'travestis',
  transexuais: 'transexuais',
  transexual: 'transexuais',
  crossdressers: 'crossdressers',
  crossdresser: 'crossdressers',
  naoBinario: 'nao_binario',
  'nao-binario': 'nao_binario',
  intersexo: 'intersexo',
  dragQueen: 'drag_queen',
  dragKing: 'drag_king',
};

const practiceMap: Record<string, TPractice> = {
  sexoBaunilha: 'sexo_baunilha',
  bdsm: 'bdsm',
  BDSM: 'bdsm',
  swing: 'swing',
  menage: 'menage',
  ménage: 'menage',
  exibicionismo: 'exibicionismo',
  voyeurismo: 'voyeurismo',
  fetiches: 'fetiches',
  fetish: 'fetiches',
};

const bodyMap: Record<string, TBodyType> = {
  magros: 'magro',
  sarados: 'sarado',
  gordinhos: 'gordinho',
  altos: 'alto',
  baixos: 'baixo',
  tattoos: 'tatuado',
  tatuados: 'tatuado',
};

const relationshipMap: Record<string, TRelationshipIntent> = {
  amizade: 'friendship',
  casual: 'casual',
  relacionamentoSerio: 'serious',
  relacionamento_sério: 'serious',
  namoro: 'dating',
  encontros: 'dating',
};

const genderReverse: Record<TGenderInterest, string> = {
  homens: 'homens',
  mulheres: 'mulheres',
  casais_ele_ele: 'casais-ele-ele',
  casais_ele_ela: 'casais-ele-ela',
  casais_ela_ela: 'casais-ela-ela',
  travestis: 'travestis',
  transexuais: 'transexuais',
  crossdressers: 'crossdressers',
  nao_binario: 'naoBinario',
  intersexo: 'intersexo',
  drag_queen: 'dragQueen',
  drag_king: 'dragKing',
};

const practiceReverse: Record<TPractice, string> = {
  sexo_baunilha: 'sexoBaunilha',
  bdsm: 'BDSM',
  swing: 'swing',
  menage: 'ménage',
  exibicionismo: 'exibicionismo',
  voyeurismo: 'voyeurismo',
  fetiches: 'fetiches',
};

const bodyReverse: Record<TBodyType, string> = {
  magro: 'magros',
  sarado: 'sarados',
  gordinho: 'gordinhos',
  alto: 'altos',
  baixo: 'baixos',
  tatuado: 'tattoos',
};

const relationshipReverse: Record<TRelationshipIntent, string> = {
  friendship: 'amizade',
  casual: 'casual',
  serious: 'relacionamentoSerio',
  dating: 'namoro',
  swing: 'casual',
  fetish_exploration: 'casual',
};

function normalizeLegacyKey(value: string): string {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function collectLegacySelections(
  source: IUserPreferences | null | undefined,
  categoryKey: string,
  dictionary: Record<string, string>
): string[] {
  if (!source) return [];

  const selected: string[] = [];

  // 1) Formato por arrays de categoria:
  // { genero: ['homens', 'mulheres'] }
  const categoryValue = source[categoryKey];
  if (Array.isArray(categoryValue)) {
    for (const item of categoryValue) {
      const mapped = dictionary[String(item)];
      if (mapped) {
        selected.push(mapped);
        continue;
      }

      const normalized = normalizeLegacyKey(String(item));
      const normalizedEntry = Object.entries(dictionary).find(
        ([legacyKey]) => normalizeLegacyKey(legacyKey) === normalized
      );
      if (normalizedEntry) {
        selected.push(normalizedEntry[1]);
      }
    }
  }

  // 2) Formato por flags soltas:
  // { homens: true, mulheres: true }
  Object.keys(dictionary).forEach((legacyKey) => {
    if (source[legacyKey] === true) {
      selected.push(dictionary[legacyKey]);
    }
  });

  return unique(selected);
}

function flagsFromValues<T extends string>(
  values: T[],
  reverseMap: Record<T, string>
): Record<string, boolean> {
  const result: Record<string, boolean> = {};

  for (const value of values ?? []) {
    const legacyKey = reverseMap[value];
    if (legacyKey) {
      result[legacyKey] = true;
    }
  }

  return result;
}

function legacyCategoryArrayFromValues<T extends string>(
  values: T[],
  reverseMap: Record<T, string>
): string[] {
  return unique(
    (values ?? [])
      .map((value) => reverseMap[value])
      .filter((value): value is string => !!value)
  );
}

export function hasMeaningfulPreferenceProfile(
  profile: IUserPreferenceProfile | null | undefined
): boolean {
  if (!profile) return false;

  return (
    (profile.relationshipIntent?.length ?? 0) > 0 ||
    (profile.hardConstraints?.acceptedGenders?.length ?? 0) > 0 ||
    (profile.hardConstraints?.acceptedRelationshipIntents?.length ?? 0) > 0 ||
    (profile.softPreferences?.bodyTypes?.length ?? 0) > 0 ||
    (profile.softPreferences?.practices?.length ?? 0) > 0
  );
}

export function mapLegacyPreferencesToProfile(
  userId: string,
  legacy: IUserPreferences | null | undefined
): IUserPreferenceProfile {
  const base = createEmptyPreferenceProfile(userId);
  if (!legacy) return base;

  const relationshipIntent = collectLegacySelections(
    legacy,
    'relacionamento',
    relationshipMap
  ) as TRelationshipIntent[];

  const acceptedGenders = collectLegacySelections(
    legacy,
    'genero',
    genderMap
  ) as TGenderInterest[];

  const practices = collectLegacySelections(
    legacy,
    'praticaSexual',
    practiceMap
  ) as TPractice[];

  const bodyTypes = collectLegacySelections(
    legacy,
    'preferenciaFisica',
    bodyMap
  ) as TBodyType[];

  return {
    ...base,
    relationshipIntent,
    hardConstraints: {
      ...base.hardConstraints,
      acceptedGenders,
      acceptedRelationshipIntents: relationshipIntent,
    },
    softPreferences: {
      ...base.softPreferences,
      bodyTypes,
      practices,
    },
    updatedAt: Date.now(),
  };
}

/**
 * Converte V2 para o formato que o editor legado atual entende:
 * - flags booleanas por chave
 * - arrays por categoria também incluídos para compat
 */
export function mapProfileToLegacyEditorState(
  profile: IUserPreferenceProfile | null | undefined
): IUserPreferences {
  if (!profile) return {};

  const genero = legacyCategoryArrayFromValues(
    profile.hardConstraints?.acceptedGenders ?? [],
    genderReverse
  );

  const praticaSexual = legacyCategoryArrayFromValues(
    profile.softPreferences?.practices ?? [],
    practiceReverse
  );

  const preferenciaFisica = legacyCategoryArrayFromValues(
    profile.softPreferences?.bodyTypes ?? [],
    bodyReverse
  );

  const relacionamento = legacyCategoryArrayFromValues(
    profile.relationshipIntent ?? [],
    relationshipReverse
  );

  return {
    genero,
    praticaSexual,
    preferenciaFisica,
    relacionamento,
    ...flagsFromValues(profile.hardConstraints?.acceptedGenders ?? [], genderReverse),
    ...flagsFromValues(profile.softPreferences?.practices ?? [], practiceReverse),
    ...flagsFromValues(profile.softPreferences?.bodyTypes ?? [], bodyReverse),
    ...flagsFromValues(profile.relationshipIntent ?? [], relationshipReverse),
  };
}

/**
 * Converte o estado atual do editor legado em payload legado agrupado.
 * Esse payload continua útil para dual-write temporário do serviço antigo.
 */
export function mapLegacyEditorStateToGroupedLegacy(
  source: IUserPreferences | null | undefined
): IUserPreferences {
  if (!source) {
    return {
      genero: [],
      praticaSexual: [],
      preferenciaFisica: [],
      relacionamento: [],
    };
  }

  return {
    genero: legacyCategoryArrayFromValues(
      collectLegacySelections(source, 'genero', genderMap) as TGenderInterest[],
      genderReverse
    ),
    praticaSexual: legacyCategoryArrayFromValues(
      collectLegacySelections(source, 'praticaSexual', practiceMap) as TPractice[],
      practiceReverse
    ),
    preferenciaFisica: legacyCategoryArrayFromValues(
      collectLegacySelections(source, 'preferenciaFisica', bodyMap) as TBodyType[],
      bodyReverse
    ),
    relacionamento: legacyCategoryArrayFromValues(
      collectLegacySelections(source, 'relacionamento', relationshipMap) as TRelationshipIntent[],
      relationshipReverse
    ),
  };
}