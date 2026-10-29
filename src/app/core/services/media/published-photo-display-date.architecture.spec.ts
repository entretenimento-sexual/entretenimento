import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = (path: string) =>
  readFileSync(resolve(process.cwd(), path), 'utf8');

describe('data de exibição de foto pertence à publicação canônica', () => {
  it('aciona backend via Observable e não usa documento de origem', () => {
    const component = source('src/app/media/photos/profile-photos/profile-photos.component.ts');
    const template = source('src/app/media/photos/profile-photos/profile-photos.component.html');
    const service = source('src/app/core/services/media/media-publication.service.ts');
    expect(component).toContain('updatePublishedPhotoDisplayDate$(');
    expect(component).not.toContain('photoFirestoreService.updatePhotoDisplayDate(');
    const mapper = source('src/app/core/services/media/owner-published-photo-cards.policy.ts');
    expect(mapper).toContain('displayDate: publication.displayDate');
    expect(template).toContain('[showSecondaryAction]="item.publication.isPublished"');
    expect(service).toContain("'updatePublishedPhotoDisplayDate'");
    expect(service).toContain('displayDate: item.displayDate');
  });

  it('não expõe metadados organizacionais nem depende do original privado', () => {
    const backend = source('functions/src/media/application/update-published-photo-display-date.handler.ts');
    expect(backend).toContain('enforceAppCheck: REQUIRE_CALLABLE_APP_CHECK');
    expect(backend).toContain('assertMediaAuthoringEligibility(ownerUid)');
    expect(backend).toContain('consumeBackendRateLimitQuota({');
    expect(backend).toContain('tx.get(publicationRef)');
    expect(backend).toContain('tx.get(projectionRef)');
    expect(backend).toContain('tx.get(deletionRef)');
    expect(backend).toContain('tx.update(publicationRef, {');
    expect(backend).not.toContain('tx.update(projectionRef,');
    expect(backend).not.toContain('users/${ownerUid}/photos/');
  });
});
