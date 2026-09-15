import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  COMMUNITY_OWNERSHIP_CANDIDATE_PAGE_SIZE,
  resolveCommunityOwnershipCandidatePageWindow,
} from './community-ownership-candidate-page.policy';

describe('community ownership candidate page policy', () => {
  it('expõe cursor no último vínculo varrido quando existe lookahead', () => {
    const documents = Array.from(
      { length: COMMUNITY_OWNERSHIP_CANDIDATE_PAGE_SIZE + 1 },
      (_, index) => ({ id: `member-${String(index + 1).padStart(3, '0')}` })
    );

    const page = resolveCommunityOwnershipCandidatePageWindow(documents);

    assert.equal(
      page.documents.length,
      COMMUNITY_OWNERSHIP_CANDIDATE_PAGE_SIZE
    );
    assert.equal(page.documents[0]?.id, 'member-001');
    assert.equal(page.documents.at(-1)?.id, 'member-050');
    assert.equal(page.nextCursor, 'member-050');
  });

  it('encerra a paginação quando não existe documento adicional', () => {
    const documents = Array.from(
      { length: COMMUNITY_OWNERSHIP_CANDIDATE_PAGE_SIZE },
      (_, index) => ({ id: `member-${index + 1}` })
    );

    const page = resolveCommunityOwnershipCandidatePageWindow(documents);

    assert.equal(
      page.documents.length,
      COMMUNITY_OWNERSHIP_CANDIDATE_PAGE_SIZE
    );
    assert.equal(page.nextCursor, null);
  });

  it('mantém página vazia sem cursor', () => {
    assert.deepEqual(resolveCommunityOwnershipCandidatePageWindow([]), {
      documents: [],
      nextCursor: null,
    });
  });
});
