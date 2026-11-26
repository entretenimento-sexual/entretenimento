# CHAT-R1.10.3.4.3D.2.1B — navegação SPA e ciclo de vida

Base de6a3ae: Quality Gate / aggregate e os três workflows aprovados.
Carga original: 25/25/22 tentativas, 17/15/14 respostas, 8/10/8 abortos.
Descoberta 45/45/45, zero HTTP 429, histórico 181/181/181.
A contabilidade D.2.1A.1 permanece intacta.

Nova carga separada spa-lifecycle: quatro contas sintéticas em emulador,
duas conexões criadas pelos callables canônicos. Navegação por controles
reais do sidebar, activity hub e cards de Amizades. Sentinel de documento
e contagem de document-request verificam cada transição interna; nenhum
pushState, replaceState, router injetado ou page.goto em transições SPA.
Deep link e reload intencionais medidos em fases próprias. Bootstrap,
troca de perfis, unsubscribe, reinscrição de consumidores, polling real
de 60s, evento canônico direcional e logout/login de outra identidade.
A nova identidade deve ter lista vazia e não exibir a solicitação anterior.
Os testes de descarte de respostas em voo por sessão/revisão já existentes
continuam no Quality Gate; a nova carga não simula uma resposta tardia
controlada no navegador.

Métrica por fase e contexto em spa-lifecycle-samples.json; tentativas
individuais em pending-read-attempts.json; origem em pending-read-origins.json.
A carga complementar anterior permanece separada da nova carga.
O logger opt-in registra unsubscribe sem UID ou dados pessoais.
Nenhuma alteração de cache, regras, callable, timer, quotas ou autorização.
As três réplicas já configuradas executam o novo cenário; exigir CI integral.
Não declarar economia ou homologação antes dos resultados.
