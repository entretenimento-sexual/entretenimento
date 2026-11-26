# CHAT-R1.10.3.4.1a — Compartilhamento do sinal de revisão

Base: eebeb688, Quality Gate 45747988651 e Chromium 45747988641 aprovados.

A descoberta legada, a descoberta progressiva e a autorização individual
passam a compartilhar um único stream de revisão por sessão autorizada.
O stream é frio até o primeiro consumidor, encerra o listener ao sair o último,
reinicia sem replay anterior na troca de UID, revogação ou erro e mantém
a revisão nula enquanto o documento não estiver confirmado pelo servidor.

Não compartilha documentos de chat, decisões de autorização, mensagens ou
recibos. Cada consumidor continua verificando candidatos no backend e lendo
documentos sujeitos às Rules. A revisão é sinal de invalidação, não autorização.
A recuperação de erros permanece nas fronteiras existentes do repositório.
Nenhuma alteração de Rules, quotas, funções ou produção.

Testes adicionados: compartilhamento e teardown, snapshot não confirmado,
troca de conta, revogação e novo login no mesmo UID, erro e reconexão.
A certificação depende da CI do novo commit. O compartilhamento dos
snapshots de chat requer etapa separada, com prova de isolamento por
geração e sem replay de autorização revogada.
