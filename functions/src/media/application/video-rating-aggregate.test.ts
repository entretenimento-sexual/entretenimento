import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildNextVideoRatingAggregate,
  normalizeVideoRating,
} from './video-rating-aggregate';

describe('video-rating-aggregate', () => {
  it('aceita somente notas numéricas inteiras entre 1 e 5', () => {
    assert.equal(normalizeVideoRating(1), 1);
    assert.equal(normalizeVideoRating(5), 5);
    assert.equal(normalizeVideoRating(0), null);
    assert.equal(normalizeVideoRating(4.5), null);
    assert.equal(normalizeVideoRating('3'), null);
    assert.equal(normalizeVideoRating(true), null);
  });

  it('adiciona a primeira avaliação', () => {
    assert.deepEqual(
      buildNextVideoRatingAggregate({}, null, 4),
      {
        ratingsCount: 1,
        ratingTotal: 4,
        ratingAverage: 4,
      }
    );
  });

  it('altera a nota sem aumentar a quantidade', () => {
    assert.deepEqual(
      buildNextVideoRatingAggregate(
        {
          ratingsCount: 2,
          ratingTotal: 7,
          ratingAverage: 3.5,
        },
        3,
        5
      ),
      {
        ratingsCount: 2,
        ratingTotal: 9,
        ratingAverage: 4.5,
      }
    );
  });

  it('reconstrói o total a partir da média em documentos antigos', () => {
    assert.deepEqual(
      buildNextVideoRatingAggregate(
        {
          ratingsCount: 2,
          ratingAverage: 4,
        },
        null,
        5
      ),
      {
        ratingsCount: 3,
        ratingTotal: 13,
        ratingAverage: 4.33,
      }
    );
  });
});
