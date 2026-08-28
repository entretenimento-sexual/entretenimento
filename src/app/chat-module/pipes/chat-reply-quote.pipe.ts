// src/app/chat-module/pipes/chat-reply-quote.pipe.ts
// -----------------------------------------------------------------------------
// ChatReplyQuotePipe
// -----------------------------------------------------------------------------
// Interpreta citação textual enviada pelo recurso de responder mensagem.
//
// Formato aceito:
// > Nome: trecho citado
//
// resposta do usuário
//
// Decisão:
// - manter o texto persistido sem migration/backend;
// - melhorar apenas a renderização visual;
// - se a mensagem não seguir o padrão, renderiza como texto normal.
// -----------------------------------------------------------------------------

import { Pipe, PipeTransform } from '@angular/core';

type ChatReplyQuoteView = {
  hasQuote: boolean;
  quoteSender: string;
  quoteText: string;
  body: string;
};

@Pipe({
  name: 'chatReplyQuote',
  standalone: false,
})
export class ChatReplyQuotePipe implements PipeTransform {
  transform(content: string | null | undefined): ChatReplyQuoteView {
    const raw = String(content ?? '');
    const normalized = raw.replace(/\r\n/g, '\n');

    if (!normalized.startsWith('> ')) {
      return this.asBody(raw);
    }

    const separatorIndex = normalized.indexOf('\n\n');

    if (separatorIndex <= 0) {
      return this.asBody(raw);
    }

    const firstLine = normalized.slice(2, separatorIndex).trim();
    const body = normalized.slice(separatorIndex + 2).trim();
    const colonIndex = firstLine.indexOf(':');

    if (colonIndex <= 0 || !body) {
      return this.asBody(raw);
    }

    const quoteSender = firstLine.slice(0, colonIndex).trim();
    const quoteText = firstLine.slice(colonIndex + 1).trim();

    if (!quoteSender || !quoteText) {
      return this.asBody(raw);
    }

    return {
      hasQuote: true,
      quoteSender,
      quoteText,
      body,
    };
  }

  private asBody(content: string): ChatReplyQuoteView {
    return {
      hasQuote: false,
      quoteSender: '',
      quoteText: '',
      body: content,
    };
  }
}
