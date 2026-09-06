// functions/src/community/community-my-page-scan.policy.ts
// -----------------------------------------------------------------------------
// COMMUNITY "MY PAGE" INCREMENTAL SCAN POLICY
// -----------------------------------------------------------------------------
// Mantém o mesmo teto de tolerância a entradas obsoletas do índice privado,
// mas evita ler/revalidar antecipadamente todos os candidatos quando a página
// já pode ser preenchida com os primeiros documentos válidos.
// -----------------------------------------------------------------------------

export const COMMUNITY_MY_PAGE_SCAN_MULTIPLIER = 3;

export interface CommunityMyPageScanResult<TDocument, TItem> {
  readonly items: readonly TItem[];
  readonly lastConsumedDocument: TDocument | null;
  readonly mayHaveAnotherPage: boolean;
  readonly validatedDocumentCount: number;
}

interface CommunityMyPageScanOptions<TDocument, TItem> {
  readonly limit: number;
  readonly loadBatch: (
    afterDocument: TDocument | null,
    limit: number
  ) => Promise<readonly TDocument[]>;
  readonly validateDocuments: (
    documents: readonly TDocument[]
  ) => Promise<readonly (TItem | null)[]>;
}

async function validateExactBatch<TDocument, TItem>(
  documents: readonly TDocument[],
  validateDocuments: CommunityMyPageScanOptions<
    TDocument,
    TItem
  >['validateDocuments']
): Promise<readonly (TItem | null)[]> {
  if (documents.length === 0) return [];

  const validated = await validateDocuments(documents);

  if (validated.length !== documents.length) {
    throw new Error(
      'Community my-page validator returned a result with an invalid length.'
    );
  }

  return validated;
}

export async function collectCommunityMyPageIncrementally<TDocument, TItem>(
  options: CommunityMyPageScanOptions<TDocument, TItem>
): Promise<CommunityMyPageScanResult<TDocument, TItem>> {
  const limit = Math.max(1, Math.trunc(options.limit));
  const maximumValidatedDocuments =
    limit * COMMUNITY_MY_PAGE_SCAN_MULTIPLIER + 1;
  const items: TItem[] = [];
  let lastConsumedDocument: TDocument | null = null;
  let validatedDocumentCount = 0;
  let mayHaveAnotherPage = false;

  while (
    items.length < limit
    && validatedDocumentCount < maximumValidatedDocuments
  ) {
    const remainingItems = limit - items.length;
    const remainingValidationBudget =
      maximumValidatedDocuments - validatedDocumentCount;
    const requestedBatchSize = Math.min(
      remainingValidationBudget,
      remainingItems + 1
    );
    const loadedDocuments = await options.loadBatch(
      lastConsumedDocument,
      requestedBatchSize
    );
    const documents = loadedDocuments.slice(0, requestedBatchSize);

    if (documents.length === 0) {
      mayHaveAnotherPage = false;
      break;
    }

    const primaryDocumentCount = Math.min(
      remainingItems,
      documents.length
    );
    const primaryDocuments = documents.slice(0, primaryDocumentCount);
    const primaryItems = await validateExactBatch(
      primaryDocuments,
      options.validateDocuments
    );

    for (let index = 0; index < primaryDocuments.length; index += 1) {
      lastConsumedDocument = primaryDocuments[index] ?? null;
      validatedDocumentCount += 1;

      const item = primaryItems[index] ?? null;
      if (item) items.push(item);
    }

    if (items.length >= limit) {
      mayHaveAnotherPage =
        documents.length > primaryDocuments.length
        || documents.length === requestedBatchSize;
      break;
    }

    const bufferedDocuments = documents.slice(primaryDocuments.length);

    if (
      bufferedDocuments.length > 0
      && validatedDocumentCount < maximumValidatedDocuments
    ) {
      const bufferedItems = await validateExactBatch(
        bufferedDocuments,
        options.validateDocuments
      );

      for (let index = 0; index < bufferedDocuments.length; index += 1) {
        if (validatedDocumentCount >= maximumValidatedDocuments) break;

        lastConsumedDocument = bufferedDocuments[index] ?? null;
        validatedDocumentCount += 1;

        const item = bufferedItems[index] ?? null;
        if (item) items.push(item);

        if (items.length >= limit) break;
      }
    }

    if (items.length >= limit) {
      mayHaveAnotherPage =
        documents.length === requestedBatchSize;
      break;
    }

    mayHaveAnotherPage = documents.length === requestedBatchSize;

    if (!mayHaveAnotherPage) break;
  }

  return {
    items,
    lastConsumedDocument,
    mayHaveAnotherPage,
    validatedDocumentCount,
  };
}
