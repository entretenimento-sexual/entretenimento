import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  hasVideoPublicationTextChanged,
  normalizeVideoPublicationSettings,
} from './video-publication-settings';

describe('video-publication-settings', () => {
  it('normaliza textos e mantém preferências explícitas', () => {
    const settings = normalizeVideoPublicationSettings({
      title: '  Uma   noite especial  ',
      description: '  História\ncom   espaços  ',
      reactionsEnabled: false,
      commentsEnabled: true,
      ratingsEnabled: false,
    });

    assert.deepEqual(settings, {
      title: 'Uma noite especial',
      description: 'História com espaços',
      reactionsEnabled: false,
      commentsEnabled: true,
      ratingsEnabled: false,
    });
  });

  it('aplica preferências abertas por padrão', () => {
    const settings = normalizeVideoPublicationSettings({});

    assert.equal(settings.title, null);
    assert.equal(settings.description, null);
    assert.equal(settings.reactionsEnabled, true);
    assert.equal(settings.commentsEnabled, true);
    assert.equal(settings.ratingsEnabled, true);
  });

  it('limita título e descrição no backend', () => {
    const settings = normalizeVideoPublicationSettings({
      title: 't'.repeat(200),
      description: 'd'.repeat(1200),
    });

    assert.equal(settings.title?.length, 120);
    assert.equal(settings.description?.length, 1000);
  });

  it('exige nova moderação apenas quando texto muda', () => {
    const previous = normalizeVideoPublicationSettings({
      title: 'Título',
      description: 'Descrição',
      reactionsEnabled: true,
      commentsEnabled: true,
      ratingsEnabled: true,
    });
    const preferencesOnly = {
      ...previous,
      commentsEnabled: false,
    };
    const changedText = {
      ...previous,
      description: 'Nova descrição',
    };

    assert.equal(
      hasVideoPublicationTextChanged(previous, preferencesOnly),
      false
    );
    assert.equal(
      hasVideoPublicationTextChanged(previous, changedText),
      true
    );
  });
});
