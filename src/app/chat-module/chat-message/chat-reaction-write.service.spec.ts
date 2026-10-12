import { describe, expect, it, vi, beforeEach } from 'vitest';
import { FieldPath, deleteField, doc, updateDoc } from 'firebase/firestore';
import { ChatReactionWriteService } from './chat-reaction-write.service';
import type { Firestore } from '@angular/fire/firestore';

vi.mock('firebase/firestore', async (importOriginal) => {
  const actual = await importOriginal<typeof import('firebase/firestore')>();
  return { ...actual, doc: vi.fn(), updateDoc: vi.fn() };
});

describe('ChatReactionWriteService', () => {
  const firestore = {} as Firestore;
  const reference = { path: 'chats/chat-1/messages/message-1' };
  const service = new ChatReactionWriteService(firestore);

  beforeEach(() => {
    vi.mocked(doc).mockReset();
    vi.mocked(doc).mockReturnValue(reference as ReturnType<typeof doc>);
    vi.mocked(updateDoc).mockReset();
    vi.mocked(updateDoc).mockResolvedValue(undefined);
  });

  it('atualiza exclusivamente a reação do UID atual por FieldPath', async () => {
    await service.write('chat-1', 'message-1', 'u1', '❤️');
    expect(doc).toHaveBeenCalledWith(firestore, reference.path);
    expect(updateDoc).toHaveBeenCalledTimes(1);
    const [ref, field, value] = vi.mocked(updateDoc).mock.calls[0];
    expect(ref).toBe(reference);
    expect(field).toBeInstanceOf(FieldPath);
    expect((field as FieldPath).isEqual(new FieldPath('reactionsByUser', 'u1'))).toBe(true);
    expect(value).toBe('❤️');
  });

  it('remove exclusivamente o UID atual com deleteField', async () => {
    await service.write('chat-1', 'message-1', 'u2', null);
    const [ref, field, value] = vi.mocked(updateDoc).mock.calls[0];
    expect(ref).toBe(reference);
    expect((field as FieldPath).isEqual(new FieldPath('reactionsByUser', 'u2'))).toBe(true);
    expect(value).toEqual(deleteField());
  });

  it('propaga erro de persistência ao consumidor', async () => {
    const error = new Error('offline');
    vi.mocked(updateDoc).mockRejectedValueOnce(error);
    await expect(service.write('chat-1', 'message-1', 'u1', '🔥')).rejects.toBe(error);
  });
});
