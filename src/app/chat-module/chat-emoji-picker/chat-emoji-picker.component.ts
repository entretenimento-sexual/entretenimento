// src/app/chat-module/chat-emoji-picker/chat-emoji-picker.component.ts
// -----------------------------------------------------------------------------
// ChatEmojiPickerComponent
// -----------------------------------------------------------------------------
// Painel de emojis do composer.
//
// Responsabilidades:
// - exibir categorias de emojis;
// - inserir emoji usando ChatEmojiComposerDirective;
// - guardar emojis recentes localmente;
// - fechar painel após inserção bem-sucedida.
//
// SUPRESSÃO EXPLÍCITA:
// - não usa biblioteca externa de emoji nesta etapa.
//
// Motivo:
// - evita aumentar bundle do chat;
// - mantém compatibilidade mobile/navegadores;
// - permite evoluir para busca/categorias completas depois.
// -----------------------------------------------------------------------------

import { Component, Input } from '@angular/core';
import { ChatEmojiComposerDirective } from '../directives/chat-emoji-composer.directive';

type ChatEmojiItem = {
  emoji: string;
  label: string;
};

type ChatEmojiGroup = {
  title: string;
  ariaLabel: string;
  items: ChatEmojiItem[];
};

@Component({
  selector: 'app-chat-emoji-picker',
  templateUrl: './chat-emoji-picker.component.html',
  styleUrls: ['./chat-emoji-picker.component.css'],
  standalone: false,
})
export class ChatEmojiPickerComponent {
  @Input() composer: ChatEmojiComposerDirective | null = null;

  recentEmojis: ChatEmojiItem[] = this.readRecentEmojis();

  readonly groups: ChatEmojiGroup[] = [
    {
      title: 'Favoritos',
      ariaLabel: 'Emojis favoritos',
      items: [
        { emoji: '😀', label: 'Emoji sorrindo' },
        { emoji: '😂', label: 'Emoji rindo' },
        { emoji: '😊', label: 'Emoji feliz' },
        { emoji: '😍', label: 'Emoji apaixonado' },
        { emoji: '😘', label: 'Emoji beijo' },
        { emoji: '😉', label: 'Emoji piscando' },
        { emoji: '👀', label: 'Emoji olhar' },
        { emoji: '🔥', label: 'Emoji fogo' },
      ],
    },
    {
      title: 'Rostos',
      ariaLabel: 'Emojis de rosto',
      items: [
        { emoji: '🙂', label: 'Emoji leve sorriso' },
        { emoji: '😄', label: 'Emoji sorridente' },
        { emoji: '😌', label: 'Emoji aliviado' },
        { emoji: '🤔', label: 'Emoji pensativo' },
        { emoji: '🫣', label: 'Emoji tímido' },
        { emoji: '🫠', label: 'Emoji derretendo' },
        { emoji: '😎', label: 'Emoji óculos' },
        { emoji: '😏', label: 'Emoji provocante' },
        { emoji: '😇', label: 'Emoji anjo' },
        { emoji: '😈', label: 'Emoji diabinho' },
        { emoji: '😮', label: 'Emoji surpresa' },
        { emoji: '🥲', label: 'Emoji chorando' },
      ],
    },
    {
      title: 'Reações',
      ariaLabel: 'Emojis de reação',
      items: [
        { emoji: '❤️', label: 'Coração vermelho' },
        { emoji: '🩷', label: 'Coração rosa' },
        { emoji: '💜', label: 'Coração roxo' },
        { emoji: '💖', label: 'Coração brilhando' },
        { emoji: '💋', label: 'Beijo' },
        { emoji: '✨', label: 'Faíscas' },
        { emoji: '👏', label: 'Palmas' },
        { emoji: '👍', label: 'Polegar positivo' },
        { emoji: '🙏', label: 'Mãos juntas' },
        { emoji: '💪', label: 'Musculoso' },
        { emoji: '👀', label: 'Olhos' },
        { emoji: '💯', label: 'Marca de cem' },
      ],
    },
    {
      title: 'Clima',
      ariaLabel: 'Emojis de clima e encontro',
      items: [
        { emoji: '🍷', label: 'Taça' },
        { emoji: '🥂', label: 'Brinde' },
        { emoji: '☕', label: 'Café' },
        { emoji: '🎶', label: 'Música' },
        { emoji: '🎉', label: 'Festa' },
        { emoji: '🌙', label: 'Lua' },
        { emoji: '⭐', label: 'Estrela' },
        { emoji: '🌹', label: 'Rosa' },
        { emoji: '📍', label: 'Localização' },
        { emoji: '⏰', label: 'Relógio' },
        { emoji: '🚕', label: 'Táxi' },
        { emoji: '🔒', label: 'Cadeado' },
      ],
    },
  ];

  insertEmoji(item: ChatEmojiItem, picker: HTMLDetailsElement): void {
    const inserted = this.composer?.insert(item.emoji) === true;

    if (!inserted) {
      return;
    }

    this.rememberEmoji(item);
    picker.open = false;
  }

  private rememberEmoji(item: ChatEmojiItem): void {
    const next = [
      item,
      ...this.recentEmojis.filter((current) => current.emoji !== item.emoji),
    ].slice(0, 8);

    this.recentEmojis = next;

    try {
      localStorage.setItem(
        'chat:recent-emojis',
        JSON.stringify(next.map((emojiItem) => emojiItem.emoji))
      );
    } catch {
      // storage indisponível não deve quebrar o chat.
    }
  }

  private readRecentEmojis(): ChatEmojiItem[] {
    try {
      const raw = localStorage.getItem('chat:recent-emojis');
      const values = JSON.parse(raw || '[]');

      if (!Array.isArray(values)) {
        return [];
      }

      return values
        .map((emoji) => String(emoji ?? '').trim())
        .filter(Boolean)
        .slice(0, 8)
        .map((emoji) => ({ emoji, label: `Emoji recente ${emoji}` }));
    } catch {
      return [];
    }
  }
}
