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
    AGE_VERIFICATION_REQUIRED:
      'Conclua a verificação de maioridade antes de acessar este conteúdo.',
    AGE_ACCESS_DENIED:
      'O acesso adulto não está disponível para esta conta.',
    AGE_REVERIFICATION_REQUIRED:
      'Conclua a revalidação de idade antes de acessar este conteúdo.',

    terms_required:
      'Aceite os termos vigentes antes de continuar.',
    adult_consent_required:
      'Confirme o acesso à experiência adulta antes de continuar.',
    age_reverification_required:
      'Conclua a revalidação de idade antes de continuar.',
    verification_required:
      'Conclua a verificação de maioridade antes de continuar.',
    review_required:
      'A verificação de maioridade precisa ser concluída antes de continuar.',
    verification_expired:
      'Sua verificação de maioridade expirou. Verifique novamente para continuar.',
    record_mismatch:
      'Sua verificação de maioridade precisa ser atualizada antes de continuar.',
    policy_outdated:
      'Sua verificação de maioridade precisa ser atualizada antes de continuar.',
    underage:
      'O acesso adulto não está disponível para esta conta.',
    account_interaction_blocked:
      'Esta conta não pode realizar esta ação no momento.',
    moderation_automation_hold:
      'Esta ação está temporariamente indisponível enquanto uma revisão é concluída.',

    reservation_count_exceeded:
      'Muitos uploads foram iniciados em pouco tempo. Tente novamente mais tarde.',
    reserved_bytes_exceeded:
      'O limite temporário de uploads foi atingido. Tente novamente mais tarde.',

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
    AGE_VERIFICATION_REQUIRED: {
      surface: 'modal',
      severity: 'info',
      title: 'Verificação de maioridade necessária',
      primaryAction: {
        label: 'Verificar agora',
        route: '/adulto/verificar-idade',
      },
      dismissLabel: 'Agora não',
    },
    AGE_ACCESS_DENIED: {
      surface: 'modal',
      severity: 'warning',
      title: 'Acesso adulto indisponível',
      primaryAction: { label: 'Ver status da conta', route: '/conta/status' },
      dismissLabel: 'Fechar',
    },
    AGE_REVERIFICATION_REQUIRED: {
      surface: 'modal',
      severity: 'warning',
      title: 'Confirmação de maioridade necessária',
      primaryAction: {
        label: 'Revalidar agora',
        route: '/adulto/revalidar',
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
    age_reverification_required: {
      surface: 'modal',
      severity: 'warning',
      title: 'Confirmação de maioridade necessária',
      primaryAction: {
        label: 'Revalidar agora',
        route: '/adulto/revalidar',
      },
      dismissLabel: 'Agora não',
    },
    verification_required: {
      surface: 'modal',
      severity: 'info',
      title: 'Verificação de maioridade necessária',
      primaryAction: {
        label: 'Verificar agora',
        route: '/adulto/verificar-idade',
      },
      dismissLabel: 'Agora não',
    },
    review_required: {
      surface: 'modal',
      severity: 'info',
      title: 'Verificação em andamento',
      dismissLabel: 'Fechar',
    },
    verification_expired: {
      surface: 'modal',
      severity: 'warning',
      title: 'Verificação de maioridade expirada',
      primaryAction: {
        label: 'Verificar novamente',
        route: '/adulto/verificar-idade',
      },
      dismissLabel: 'Agora não',
    },
    record_mismatch: {
      surface: 'modal',
      severity: 'warning',
      title: 'Verificação precisa ser atualizada',
      primaryAction: {
        label: 'Atualizar verificação',
        route: '/adulto/verificar-idade',
      },
      dismissLabel: 'Agora não',
    },
    policy_outdated: {
      surface: 'modal',
      severity: 'warning',
      title: 'Verificação precisa ser atualizada',
      primaryAction: {
        label: 'Atualizar verificação',
        route: '/adulto/verificar-idade',
      },
      dismissLabel: 'Agora não',
    },
    underage: {
      surface: 'modal',
      severity: 'warning',
      title: 'Acesso adulto indisponível',
      primaryAction: { label: 'Ver status da conta', route: '/conta/status' },
      dismissLabel: 'Fechar',
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
  return MEDIA_ERROR_MESSAGES[reason] ?? null;
}

export function resolveMediaErrorPresentation(
  reason: string | null | undefined
): ApplicationErrorPresentation | null {
  if (!reason) return null;
  return MEDIA_ERROR_PRESENTATIONS[reason] ?? null;
}
