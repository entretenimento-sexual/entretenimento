# CHAT-R1.10.3.4.3D.5.2A — shared friends observation

Base: 07da3d4944072a75e09700b561fd809e4f26454d.

Incremento inicial: FriendsRepo.watchFriends mantém a assinatura pública. Um listener por identidade operacional e tamanho de página, dentro da mesma instância da aplicação. A última projeção bruta ativa é compartilhada, mas a hidratação pública concluída não é armazenada. Novos consumidores repetem a validação pública ou ingressam em hidratação simultânea. A última desinscrição libera o listener. Novos snapshots descartam hidratações anteriores. Revogação ou substituição de instância de autenticação encerra a observação com erro tipado; os consumidores mantêm seus caminhos de erro existentes.

As leituras pontuais, paginação, autorização backend, regras, polling de solicitações e limites permanecem intactos. Não há compartilhamento de dados entre abas. A certificação deverá verificar os consumidores reais, o tratamento de troca de sessão com mesmo UID e a recuperação do estado de amizade, além das contagens de listeners e hidratações. Não considerar a projeção local uma nova autoridade de autorização.

A matriz multinavegador de UX permanece separada.
