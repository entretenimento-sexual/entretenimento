import { describe, expect, it } from 'vitest';
import { FieldPath, deleteField } from 'firebase/firestore';
import { directReactionFieldUpdate } from './chat-reaction-write.service';

describe('directReactionFieldUpdate', () => {
  it('constrói FieldPath por UID sem substituir o mapa de outras reações', () => {
    const { field, value } = directReactionFieldUpdate('u1', '❤️');
    expect(field).toBeInstanceOf(FieldPath);
    expect(field.isEqual(new FieldPath('reactionsByUser', 'u1'))).toBe(true);
    expect(value).toBe('❤️');
  });

  it('remove apenas a reação do UID indicado', () => {
    const { field, value } = directReactionFieldUpdate('u2', null);
    expect(field.isEqual(new FieldPath('reactionsByUser', 'u2'))).toBe(true);
    expect(value).toEqual(deleteField());
  });

  it('mantém UIDs com pontos como um único segmento de campo', () => {
    const { field, value } = directReactionFieldUpdate('uid.with.dot', '🔥');
    expect(field.isEqual(new FieldPath('reactionsByUser', 'uid.with.dot'))).toBe(true);
    expect(value).toBe('🔥');
  });
});
