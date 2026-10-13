import { describe, expect, it, vi } from 'vitest';

import { ChatEmojiPickerComponent } from './chat-emoji-picker.component';

describe('ChatEmojiPickerComponent', () => {
  it('não insere emojis quando o composer está bloqueado', () => {
    const picker = new ChatEmojiPickerComponent();
    const insert = vi.fn(() => true);
    picker.composer = { insert } as any;
    picker.disabled = true;
    const panel = { open: true } as HTMLDetailsElement;

    picker.insertEmoji({ emoji: '😀', label: 'Sorriso' }, panel);

    expect(insert).not.toHaveBeenCalled();
    expect(panel.open).toBe(true);
  });
});
