export interface ExternalPushNotificationContent {
  title: string;
  body: string;
}

const PRIVATE_PUSH_TITLE = 'Entretenimento';
const PRIVATE_PUSH_BODY = 'Você tem uma nova notificação.';

/**
 * O conteúdo detalhado permanece exclusivamente na Central de Notificações.
 *
 * Web Push pode aparecer em tela bloqueada, relógios, espelhamento do sistema
 * operacional e outros contextos fora do controle da aplicação. Por isso o
 * payload externo usa texto neutro por padrão e carrega somente a rota segura
 * necessária para abrir a experiência autenticada.
 */
export function buildPrivatePushContent(): ExternalPushNotificationContent {
  return {
    title: PRIVATE_PUSH_TITLE,
    body: PRIVATE_PUSH_BODY,
  };
}
