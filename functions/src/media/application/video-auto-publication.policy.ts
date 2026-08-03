export interface AutoPublishVideoRegistrationData {
  publishWhenReady?: unknown;
  [key: string]: unknown;
}

/**
 * O staging privado de vídeo é exclusivamente técnico.
 * Clientes antigos podem continuar enviando a propriedade, mas nunca podem
 * desativar a continuação automática para processamento e publicação.
 */
export function forceVideoAutoPublicationData(
  data: AutoPublishVideoRegistrationData | undefined
): AutoPublishVideoRegistrationData {
  return {
    ...(data ?? {}),
    publishWhenReady: true,
  };
}
