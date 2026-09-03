# Contrato visual da página de Comunidade

Este componente deve manter a Comunidade como protagonista dentro do shell global, sem reproduzir uma versão desktop apenas reduzida. Em desktop amplo, a capa deve estabelecer identidade antes do Mural, o título precisa ter hierarquia clara, o conteúdo principal deve permanecer mais largo que o rail contextual e o rail deve continuar disponível como apoio sticky, sem competir com o feed.

O Mural deve preservar alvos interativos de pelo menos 44 px, separação perceptível entre publicações, leitura confortável dos textos e mídia proporcional ao espaço disponível. Contextos de resposta e localização fazem parte do post e devem ter tratamento visual próprio, sem depender de estilos inline. A localização compartilhada deve continuar mostrando apenas a precisão permitida pelo domínio e manter ações distintas para expandir o mapa e abrir o provedor externo.

O harness visual permanente deve manter exemplos determinísticos de contexto de resposta e localização compartilhada. O gate mede também a presença desses blocos, altura mínima da capa, escala mínima do título e altura dos controles realmente interativos dos posts, para que uma página sem overflow mas visualmente miniaturizada não seja considerada válida. Elementos meramente decorativos dentro de um controle não entram na medição do alvo de toque.

Em mobile, o layout permanece em uma coluna, sem overflow horizontal da página. Capa, identidade, abas, composer, posts, mídia, respostas e localização devem caber no viewport sem reduzir targets de toque. O rail contextual não deve ocupar espaço visual em telas estreitas; as mesmas informações continuam acessíveis pelas áreas próprias da Comunidade.

A validação automatizada cobre geometria, presença das regiões essenciais, responsividade e console. A evidência em screenshot continua sendo revisada quando houver alteração estrutural, porque ausência de overflow isoladamente não comprova qualidade visual percebida.
