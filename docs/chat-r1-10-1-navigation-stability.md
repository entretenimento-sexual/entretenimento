# CHAT-R1.10.1 — Estabilidade reativa da navegação

Base homologada: d0368314088afbe82a1762ec4f9e10d0e5158817 (Quality Gate 45691710435 e Media E2E 45691710427). A CHAT-R1.9 está homologada na etapa automatizada.

## Correções

- O erro de resolução de deep link agora é tratado dentro da intenção individual, inclusive erro síncrono; a observação da rota continua ativa. O layout usa ApplicationErrorService, sem mensagens técnicas ou novos canais de feedback.
- A intenção de URL pertence à assinatura e à sessão que a recebeu. Troca de UID/logout cancela a resolução anterior e não reaplica a URL pendente sob outro titular ou retorno ao mesmo UID. Novos parâmetros após limpeza continuam válidos. Não navegar para limpar parâmetros ausentes.
- A URL não atribui identidade visual do participante. Seleção e identificação permanecem distintas: somente a conversa canônica determina o peer. Falha na consulta de identidade pública limpa o cabeçalho daquele peer, reporta pelo canal existente e permite sincronizar uma seleção posterior.
- Nenhuma alteração em Rules, Cloud Functions, políticas de acesso, consentimento bilateral, rate limits, cache, persistência, contratos públicos existentes ou deploy. Cancelamento de Observable não desfaz callable já despachada.

## Regressões e limites

Testes adicionados: URL inválida seguida de válida; erro síncrono/assíncrono; logout/troca/retorno ao UID; nova intenção após limpeza; duplicata de parâmetros; cancelamento de resposta atrasada; falha de identidade seguida de seleção válida. Execução local não realizada; CI do novo SHA obrigatória. Homologação em navegador real ainda pendente. A recuperação de listeners após esgotamento do backoff, escala da descoberta (500), projeção agregada de não lidos e contenção sob carga permanecem pendências distintas e não são consideradas corrigidas aqui.
