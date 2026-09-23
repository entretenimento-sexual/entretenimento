import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

const complianceSourceDirectory = path.resolve(__dirname, '../../src/compliance');

function readSource(fileName: string): string {
  return readFileSync(path.join(complianceSourceDirectory, fileName), 'utf8');
}

describe('minor-safety age reverification recovery contract', () => {
  it('mantém prazo operacional recuperável e oferece análise alternativa', () => {
    const source = readSource('submit-profile-age-reverification.handler.ts');

    assert.match(source, /isAgeReverificationSubmissionAcceptedStatus/);
    assert.match(source, /requestsAlternativeReview/);
    assert.match(source, /ALTERNATIVE_TRUSTED_REVIEW_REQUEST/);
    assert.match(source, /submittedAfterOperationalTarget/);
    assert.match(source, /PROFILE_AGE_REVERIFICATION_RESPONSE_WINDOW_BASIS/);
    assert.doesNotMatch(source, /deadline-exceeded/);
  });

  it('audita denúncia inicial como suspeita, sem confirmação etária ou jurídica', () => {
    const source = readSource('report-profile-minor-safety.handler.ts');

    assert.match(source, /minor_safety\.profile_report\.received/);
    assert.match(source, /SUSPECTED_NOT_CONFIRMED/);
    assert.match(source, /NOT_DETERMINED/);
    assert.match(source, /compliance_audit/);
  });

  it('mantém a janela de sete dias explicitamente como política operacional', () => {
    const source = readSource('profile-age-reverification.policy.ts');

    assert.match(
      source,
      /PROFILE_AGE_REVERIFICATION_RESPONSE_WINDOW_BASIS\s*=\s*\n?\s*'PLATFORM_OPERATIONAL_POLICY'/
    );
    assert.match(source, /Não é prazo legal/);
    assert.match(source, /não impede envio posterior/);
  });
});
