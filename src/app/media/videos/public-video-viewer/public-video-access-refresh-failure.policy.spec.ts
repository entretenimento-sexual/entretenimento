import { describe, expect, it } from 'vitest';
import { classifyPublicVideoAccessRefreshFailure } from './public-video-access-refresh-failure.policy';

describe('PublicVideoAccessRefreshFailurePolicy', () => {
  it.each([
    ['functions/permission-denied', 'permission-denied'],
    ['functions/unauthenticated', 'unauthenticated'],
    ['functions/not-found', 'not-found'],
    ['functions/resource-exhausted', 'resource-exhausted'],
    ['functions/unavailable', 'unavailable'],
    ['functions/deadline-exceeded', 'deadline-exceeded'],
    ['functions/internal', 'unknown'],
  ] as const)('normaliza %s', (code, expected) => {
    expect(classifyPublicVideoAccessRefreshFailure({ code })).toBe(expected);
  });

  it('reconhece reason de lifecycle em failed-precondition', () => {
    expect(classifyPublicVideoAccessRefreshFailure({
      code: 'functions/failed-precondition',
      details: { reason: 'ACCOUNT_UNAVAILABLE' },
    })).toBe('permission-denied');
  });

  it('lê original sem descartar um erro encapsulado', () => {
    expect(classifyPublicVideoAccessRefreshFailure({
      original: { code: 'functions/unavailable' },
    })).toBe('unavailable');
  });

  it('não presume revogação em erro desconhecido ou nulo', () => {
    expect(classifyPublicVideoAccessRefreshFailure(null)).toBe('unknown');
    expect(classifyPublicVideoAccessRefreshFailure({
      code: 'functions/failed-precondition',
    })).toBe('unknown');
  });
});
