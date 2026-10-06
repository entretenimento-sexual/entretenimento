import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

function source(name: string): string {
  return readFileSync(
    resolve(process.cwd(), 'src', 'media', 'application', name),
    'utf8'
  );
}

describe('Media rate-limit budget contract', () => {
  it('compartilha o orçamento de signed URLs entre foto e vídeo', () => {
    const photo = source('get-public-photo-access-urls.handler.ts');
    const video = source('public-video-access-rate-limit.service.ts');

    assert.match(photo, /action:\s*['"]public-media-access-urls['"]/);
    assert.match(video, /action:\s*['"]public-media-access-urls['"]/);
    assert.match(photo, /cost:\s*itemCount/);
    assert.match(video, /cost:\s*itemCount/);
  });

  it('compartilha o orçamento de registro de views entre foto e vídeo', () => {
    const photo = source('public-photo-view-record-rate-limit.service.ts');
    const video = source('public-video-view-record-rate-limit.service.ts');

    assert.match(photo, /action:\s*['"]public-media-view-record['"]/);
    assert.match(video, /action:\s*['"]public-media-view-record['"]/);
    assert.match(photo, /cost:\s*1/);
    assert.match(video, /cost:\s*1/);
  });

  it('compartilha budgets sociais por tipo de interação', () => {
    const photo = source('public-photo-social-interaction-rate-limit.service.ts');
    const video = source('public-video-social-interaction-rate-limit.service.ts');

    for (const content of [photo, video]) {
      assert.match(content, /reaction:\s*['"]public-media-reaction['"]/);
      assert.match(content, /comment:\s*['"]public-media-comment['"]/);
    }

    assert.match(video, /rating:\s*['"]public-media-rating['"]/);
  });

  it('compartilha o orçamento de denúncias entre superfícies de Media', () => {
    const photo = source('report-photo-content.handler.ts');
    const video = source('report-video-content.handler.ts');

    assert.match(photo, /action:\s*['"]public-media-report['"]/);
    assert.match(video, /action:\s*['"]public-media-report['"]/);
    assert.match(photo, /cost:\s*moderationReportRateLimitCost\(/);
    assert.match(video, /cost:\s*moderationReportRateLimitCost\(/);
  });

  it('mantém discovery com custo proporcional ao volume solicitado', () => {
    const discovery = source('get-public-media-discovery.handler.ts');

    assert.match(
      discovery,
      /publicMediaDiscoveryReadRateLimitCost\(resultLimit\)/
    );
    assert.match(
      discovery,
      /Math\.max\(1,\s*Math\.ceil\(safeLimit\s*\/\s*24\)\)/
    );
  });
});
