import type {
  ApplicationErrorPresentation,
} from 'src/app/core/services/error-handler/application-error-presentation.model';

export const MEDIA_ERROR_MESSAGES = Object.freeze({
    ACCOUNT_UNAVAILABLE:
      'Esta conta não pode acessar conteúdo de mídia no momento.',
    TERMS_REQUIRED:
      'Aceite os termos vigentes antes de acessar conteúdo adulto.',
    ADULT_CONSENT_REQUIRED:
      'Confirme o acesso à experiência adulta antes de continuar.',

    terms_required:
      'Aceite os termos vigentes antes de continuar.',
    adult_consent_required:
      'Confirme o acesso à experiência adulta antes de continuar.',
    account_interaction_blocked:
      'Esta conta não pode realizar esta ação no momento.',
    moderation_automation_hold:
      'Esta ação está temporariamente indisponível enquanto uma revisão é concluída.',

    reservation_count_exceeded:
      'Muitos uploads foram iniciados em pouco tempo. Tente novamente mais tarde.',
    reserved_bytes_exceeded:
      'O limite temporário de uploads foi atingido. Tente novamente mais tarde.',

    photo_editor_auth_required:
      'Sua sessão não está disponível para editar fotos. Entre novamente e tente de novo.',
    photo_editor_owner_mismatch:
      'Esta foto só pode ser editada pelo perfil que a publicou.',
    photo_editor_source_unavailable:
      'A imagem original não está disponível para edição.',
    photo_editor_failed:
      'Não foi possível abrir ou concluir a edição da foto agora. Tente novamente.',
    photo_storage_owner_mismatch:
      'Esta foto só pode ser alterada pelo perfil proprietário.',
    photo_storage_path_invalid:
      'Esta foto não possui uma origem válida para a operação solicitada.',
    photo_delete_failed:
      'Não foi possível excluir a foto agora. Tente novamente.',
    profile_avatar_upload_failed:
      'Não foi possível atualizar a foto do perfil agora. Tente novamente.',
    media_replace_failed:
      'Não foi possível substituir a mídia agora. Tente novamente.',
    media_delete_failed:
      'Não foi possível excluir a mídia agora. Tente novamente.',

    media_discovery_load_failed:
      'Não foi possível carregar as mídias agora. Tente novamente.',
    media_discovery_page_failed:
      'Não foi possível carregar mais mídias agora. Tente novamente.',
    photo_discovery_load_failed:
      'Não foi possível carregar as fotos agora. Tente novamente.',
    photo_discovery_page_failed:
      'Não foi possível carregar mais fotos agora. Tente novamente.',
    photo_comments_load_failed:
      'Não foi possível carregar os comentários da foto.',
    photo_reaction_failed:
      'Não foi possível atualizar sua reação agora.',
    photo_comment_failed:
      'Não foi possível publicar o comentário agora.',
    photo_reply_failed:
      'Não foi possível publicar a resposta agora.',
    photo_comment_moderation_failed:
      'Não foi possível moderar o comentário agora.',
    profile_photos_load_failed:
      'Não foi possível carregar as fotos do perfil agora.',
    media_navigation_failed:
      'Não foi possível abrir esta área agora.',
    media_share_dialog_failed:
      'Não foi possível abrir suas conversas agora.',
    video_playback_access_failed:
      'Não foi possível carregar o vídeo. Tente novamente.',
    media_report_failed:
      'Não foi possível enviar a denúncia agora.',
    video_library_load_failed:
      'Não foi possível carregar seus vídeos agora.',
    video_editor_open_failed:
      'Não foi possível abrir o editor de vídeo agora.',
    video_publication_settings_failed:
      'Não foi possível salvar as informações do vídeo.',
    video_delete_failed:
      'Não foi possível excluir o vídeo agora.',
    video_failed_upload_cleanup_pending:
      'Alguns uploads com falha ainda aguardam limpeza automática.',
    media_upload_failed:
      'Não foi possível concluir o upload da mídia.',
    video_upload_failed:
      'Não foi possível concluir o upload do vídeo.',
    photo_upload_failed:
      'Não foi possível concluir o upload da foto.',
    media_publication_failed:
      'Não foi possível concluir a publicação da mídia.',
    media_access_temporarily_unavailable:
      'A mídia foi carregada, mas o acesso está temporariamente indisponível.',
  } as const);

export type MediaErrorReason = keyof typeof MEDIA_ERROR_MESSAGES;

export const MEDIA_ERROR_CODE_MESSAGES: Readonly<Record<string, string>> =
  Object.freeze({
    unauthenticated:
      'Sua sessão expirou. Entre novamente para continuar com esta mídia.',
    'auth/user-token-expired':
      'Sua sessão expirou. Entre novamente para continuar com esta mídia.',
    'auth/requires-recent-login':
      'Confirme sua identidade novamente antes de alterar esta mídia.',
    'storage/unauthenticated':
      'Sua sessão expirou. Entre novamente para acessar esta mídia.',
    'storage/unauthorized':
      'Você não tem permissão para acessar ou alterar este arquivo de mídia.',
    'storage/object-not-found':
      'O arquivo desta mídia não está mais disponível.',
    'storage/bucket-not-found':
      'O armazenamento de mídia está temporariamente indisponível.',
    'storage/project-not-found':
      'O serviço de armazenamento de mídia está temporariamente indisponível.',
    'storage/quota-exceeded':
      'O armazenamento de mídia atingiu um limite temporário. Tente novamente mais tarde.',
    'storage/retry-limit-exceeded':
      'Não foi possível concluir a transferência da mídia a tempo. Verifique sua conexão e tente novamente.',
    'storage/invalid-checksum':
      'O arquivo enviado não pôde ser validado. Selecione o arquivo novamente e repita o envio.',
    'storage/canceled':
      'A operação com a mídia foi cancelada antes de terminar.',
    'storage/invalid-url':
      'O endereço do arquivo de mídia não é válido ou não está mais disponível.',
    'storage/invalid-argument':
      'Os dados enviados para o armazenamento da mídia não são válidos.',
    'storage/no-default-bucket':
      'O armazenamento de mídia está temporariamente indisponível.',
    'storage/cannot-slice-blob':
      'Não foi possível ler o arquivo selecionado. Selecione o arquivo novamente.',
    'storage/server-file-wrong-size':
      'O arquivo enviado não pôde ser validado. Tente enviar novamente.',
    'storage/unknown':
      'O armazenamento de mídia encontrou uma falha inesperada. Tente novamente.',
    'permission-denied':
      'Você não tem permissão para acessar ou alterar esta mídia.',
    'not-found':
      'Esta mídia não está mais disponível.',
    'already-exists':
      'Esta alteração de mídia já foi concluída.',
    'resource-exhausted':
      'Muitas ações de mídia foram feitas em pouco tempo. Aguarde e tente novamente.',
    'failed-precondition':
      'Esta mídia não pode ser alterada no estado atual.',
    'invalid-argument':
      'Algum dado da mídia não é válido. Revise as informações e tente novamente.',
    'deadline-exceeded':
      'A operação de mídia demorou mais que o esperado. Tente novamente.',
    unavailable:
      'O serviço de mídia está temporariamente indisponível. Tente novamente em instantes.',
    aborted:
      'A operação de mídia encontrou um conflito temporário. Tente novamente.',
    cancelled:
      'A operação de mídia foi interrompida antes de ser concluída.',
    'out-of-range':
      'Um valor informado para a mídia está fora do limite permitido.',
    unimplemented:
      'Esta operação de mídia ainda não está disponível.',
    'data-loss':
      'Não foi possível validar a integridade dos dados da mídia.',
    internal:
      'O serviço de mídia encontrou uma falha interna. Tente novamente mais tarde.',
    unknown:
      'Não foi possível concluir a operação de mídia agora. Tente novamente.',
  });

export const MEDIA_ERROR_CODE_PRESENTATIONS:
  Readonly<Record<string, ApplicationErrorPresentation>> = Object.freeze({
    unauthenticated: {
      surface: 'modal',
      severity: 'warning',
      title: 'Sessão necessária',
      dismissLabel: 'Fechar',
    },
    'auth/user-token-expired': {
      surface: 'modal',
      severity: 'warning',
      title: 'Sessão expirada',
      dismissLabel: 'Fechar',
    },
    'auth/requires-recent-login': {
      surface: 'modal',
      severity: 'warning',
      title: 'Confirme sua identidade',
      dismissLabel: 'Fechar',
    },
    'storage/unauthenticated': {
      surface: 'modal',
      severity: 'warning',
      title: 'Sessão necessária',
      dismissLabel: 'Fechar',
    },
    'storage/unauthorized': {
      surface: 'modal',
      severity: 'warning',
      title: 'Ação não permitida',
      dismissLabel: 'Fechar',
    },
    'storage/object-not-found': {
      surface: 'snackbar',
      severity: 'info',
    },
    'storage/bucket-not-found': {
      surface: 'snackbar',
      severity: 'error',
    },
    'storage/project-not-found': {
      surface: 'snackbar',
      severity: 'error',
    },
    'storage/quota-exceeded': {
      surface: 'snackbar',
      severity: 'warning',
    },
    'storage/retry-limit-exceeded': {
      surface: 'snackbar',
      severity: 'warning',
    },
    'storage/invalid-checksum': {
      surface: 'snackbar',
      severity: 'error',
    },
    'storage/canceled': {
      surface: 'snackbar',
      severity: 'info',
    },
    'storage/invalid-url': {
      surface: 'snackbar',
      severity: 'warning',
    },
    'storage/invalid-argument': {
      surface: 'snackbar',
      severity: 'warning',
    },
    'storage/no-default-bucket': {
      surface: 'snackbar',
      severity: 'error',
    },
    'storage/cannot-slice-blob': {
      surface: 'snackbar',
      severity: 'warning',
    },
    'storage/server-file-wrong-size': {
      surface: 'snackbar',
      severity: 'error',
    },
    'storage/unknown': {
      surface: 'snackbar',
      severity: 'error',
    },
    'permission-denied': {
      surface: 'modal',
      severity: 'warning',
      title: 'Ação não permitida',
      dismissLabel: 'Fechar',
    },
    'not-found': {
      surface: 'snackbar',
      severity: 'info',
    },
    'already-exists': {
      surface: 'snackbar',
      severity: 'info',
    },
    'resource-exhausted': {
      surface: 'snackbar',
      severity: 'warning',
    },
    'failed-precondition': {
      surface: 'snackbar',
      severity: 'warning',
    },
    'invalid-argument': {
      surface: 'snackbar',
      severity: 'warning',
    },
    'deadline-exceeded': {
      surface: 'snackbar',
      severity: 'warning',
    },
    unavailable: {
      surface: 'snackbar',
      severity: 'warning',
    },
    aborted: {
      surface: 'snackbar',
      severity: 'warning',
    },
    cancelled: {
      surface: 'snackbar',
      severity: 'info',
    },
    'out-of-range': {
      surface: 'snackbar',
      severity: 'warning',
    },
    unimplemented: {
      surface: 'snackbar',
      severity: 'info',
    },
    'data-loss': {
      surface: 'modal',
      severity: 'error',
      title: 'Não foi possível validar a mídia',
      dismissLabel: 'Fechar',
    },
    internal: {
      surface: 'snackbar',
      severity: 'error',
    },
    unknown: {
      surface: 'snackbar',
      severity: 'error',
    },
  });

export const MEDIA_ERROR_PRESENTATIONS:
  Readonly<Record<MediaErrorReason, ApplicationErrorPresentation>> =
  Object.freeze({
    ACCOUNT_UNAVAILABLE: {
      surface: 'modal',
      severity: 'warning',
      title: 'Acesso temporariamente indisponível',
      primaryAction: { label: 'Ver status da conta', route: '/conta/status' },
      dismissLabel: 'Fechar',
    },
    TERMS_REQUIRED: {
      surface: 'modal',
      severity: 'info',
      title: 'Termos atualizados',
      primaryAction: {
        label: 'Revisar termos',
        route: '/register/aceitar-termos',
      },
      dismissLabel: 'Agora não',
    },
    ADULT_CONSENT_REQUIRED: {
      surface: 'modal',
      severity: 'info',
      title: 'Confirme seu acesso adulto',
      primaryAction: {
        label: 'Confirmar acesso',
        route: '/adulto/confirmar',
      },
      dismissLabel: 'Agora não',
    },
    terms_required: {
      surface: 'modal',
      severity: 'info',
      title: 'Termos atualizados',
      primaryAction: {
        label: 'Revisar termos',
        route: '/register/aceitar-termos',
      },
      dismissLabel: 'Agora não',
    },
    adult_consent_required: {
      surface: 'modal',
      severity: 'info',
      title: 'Confirme seu acesso adulto',
      primaryAction: {
        label: 'Confirmar acesso',
        route: '/adulto/confirmar',
      },
      dismissLabel: 'Agora não',
    },
    account_interaction_blocked: {
      surface: 'modal',
      severity: 'warning',
      title: 'Ação temporariamente indisponível',
      primaryAction: { label: 'Ver status da conta', route: '/conta/status' },
      dismissLabel: 'Fechar',
    },
    moderation_automation_hold: {
      surface: 'modal',
      severity: 'warning',
      title: 'Revisão em andamento',
      dismissLabel: 'Fechar',
    },

    reservation_count_exceeded: {
      surface: 'snackbar',
      severity: 'warning',
    },
    photo_editor_auth_required: {
      surface: 'modal',
      severity: 'warning',
      title: 'Sessão necessária para editar',
      dismissLabel: 'Fechar',
    },
    photo_editor_owner_mismatch: {
      surface: 'modal',
      severity: 'warning',
      title: 'Edição não permitida',
      detail: 'Abra a foto pelo perfil proprietário para editá-la.',
      dismissLabel: 'Fechar',
    },
    photo_editor_source_unavailable: {
      surface: 'snackbar',
      severity: 'warning',
    },
    photo_editor_failed: {
      surface: 'snackbar',
      severity: 'error',
    },
    photo_storage_owner_mismatch: {
      surface: 'modal',
      severity: 'warning',
      title: 'Alteração não permitida',
      dismissLabel: 'Fechar',
    },
    photo_storage_path_invalid: {
      surface: 'snackbar',
      severity: 'warning',
    },
    photo_delete_failed: {
      surface: 'snackbar',
      severity: 'error',
    },
    profile_avatar_upload_failed: {
      surface: 'snackbar',
      severity: 'error',
    },
    media_replace_failed: {
      surface: 'snackbar',
      severity: 'error',
    },
    media_delete_failed: {
      surface: 'snackbar',
      severity: 'error',
    },
    reserved_bytes_exceeded: {
      surface: 'snackbar',
      severity: 'warning',
    },
    media_discovery_load_failed: {
      surface: 'snackbar',
      severity: 'error',
    },
    media_discovery_page_failed: {
      surface: 'snackbar',
      severity: 'warning',
    },
    photo_discovery_load_failed: {
      surface: 'snackbar',
      severity: 'error',
    },
    photo_discovery_page_failed: {
      surface: 'snackbar',
      severity: 'warning',
    },
    photo_comments_load_failed: {
      surface: 'snackbar',
      severity: 'error',
    },
    photo_reaction_failed: {
      surface: 'snackbar',
      severity: 'error',
    },
    photo_comment_failed: {
      surface: 'snackbar',
      severity: 'error',
    },
    photo_reply_failed: {
      surface: 'snackbar',
      severity: 'error',
    },
    photo_comment_moderation_failed: {
      surface: 'snackbar',
      severity: 'error',
    },
    profile_photos_load_failed: {
      surface: 'snackbar',
      severity: 'error',
    },
    media_navigation_failed: {
      surface: 'snackbar',
      severity: 'error',
    },
    media_share_dialog_failed: {
      surface: 'snackbar',
      severity: 'error',
    },
    video_playback_access_failed: {
      surface: 'snackbar',
      severity: 'error',
    },
    media_report_failed: {
      surface: 'snackbar',
      severity: 'error',
    },
    video_library_load_failed: {
      surface: 'snackbar',
      severity: 'error',
    },
    video_editor_open_failed: {
      surface: 'snackbar',
      severity: 'error',
    },
    video_publication_settings_failed: {
      surface: 'snackbar',
      severity: 'error',
    },
    video_delete_failed: {
      surface: 'snackbar',
      severity: 'error',
    },
    video_failed_upload_cleanup_pending: {
      surface: 'snackbar',
      severity: 'warning',
    },
    media_upload_failed: {
      surface: 'snackbar',
      severity: 'error',
    },
    video_upload_failed: {
      surface: 'snackbar',
      severity: 'error',
    },
    photo_upload_failed: {
      surface: 'snackbar',
      severity: 'error',
    },
    media_publication_failed: {
      surface: 'snackbar',
      severity: 'error',
    },
    media_access_temporarily_unavailable: {
      surface: 'snackbar',
      severity: 'warning',
    },
  });

export function resolveMediaErrorMessage(
  reason: string | null | undefined
): string | null {
  if (!reason) return null;
  return MEDIA_ERROR_MESSAGES[reason as MediaErrorReason] ?? null;
}

export function resolveMediaErrorPresentation(
  reason: string | null | undefined
): ApplicationErrorPresentation | null {
  if (!reason) return null;
  return MEDIA_ERROR_PRESENTATIONS[reason as MediaErrorReason] ?? null;
}
