export interface TranscoderLookupJob {
  name?: string;
  labels?: Record<string, string>;
}

export interface TranscoderLookupPage<T extends TranscoderLookupJob> {
  jobs?: T[];
  nextPageToken?: string;
}

const MAX_LOOKUP_PAGES = 10;

/**
 * Exhaust the bounded, label-filtered result set; an empty first page is not
 * a sufficient negative when the provider offers a nextPageToken.
 * Multiple matching job names are ambiguous and must fail closed.
 */
export async function lookupUniqueTranscoderJob<T extends TranscoderLookupJob>(
  processingVersion: string,
  loadPage: (pageToken?: string) => Promise<TranscoderLookupPage<T>>
): Promise<T | null> {
  const tokens = new Set<string>();
  let pageToken: string | undefined;
  let match: T | null = null;

  for (let page = 0; page < MAX_LOOKUP_PAGES; page += 1) {
    const response = await loadPage(pageToken);
    for (const candidate of response.jobs ?? []) {
      if (candidate.labels?.['processing_version'] !== processingVersion) {
        continue;
      }

      if (!candidate.name) {
        throw new Error('Transcoder retornou job sem identificador.');
      }
      if (match && match.name !== candidate.name) {
        throw new Error('Mais de um job externo usa a mesma versão.');
      }
      match = candidate;
    }

    const next = String(response.nextPageToken ?? '').trim();
    if (!next) return match;
    if (tokens.has(next)) {
      throw new Error('Paginação circular ao procurar job no Transcoder.');
    }
    tokens.add(next);
    pageToken = next;
  }

  throw new Error('Busca de job no Transcoder excedeu o limite de páginas.');
}
