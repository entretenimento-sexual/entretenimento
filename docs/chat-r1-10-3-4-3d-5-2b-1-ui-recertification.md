# D.5.2B.1 — estabilidade da confirmação na main

SHA 31b9346 aprovado na primeira matriz Chromium (45988989973). Segunda execução 46010646664: R1/R2 aprovadas, R3 falhou na troca de conversa, linha 1248 do E2E, por interceptação do clique durante 60 segundos pela prévia pública de Browser Pessoa B no CDK overlay. Quality Gate e Media E2E aprovados. Não confundir com falha de transporte anteriormente corrigida.

A diretiva universal mantém a abertura automática por padrão. O adaptador DirectChatPublicIdentityComponent utiliza apenas o botão explícito existente (nome acessível e aria-expanded). Preservados toggle, Escape, clique externo e comportamento dos demais consumidores. Sem force click, timeout maior ou flexibilização de asserções do E2E. Testes de contrato cobrem hover padrão, opt-out e controle explícito.

Recertificar o novo SHA antes da D.5.2B.2. A correção de cursor/ordenação de amigos permanece separada. WebKit ainda não certificado.
