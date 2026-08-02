export type TPublicVideoPlaybackFailureKind =
  | 'aborted'
  | 'offline'
  | 'network'
  | 'decode'
  | 'source'
  | 'unknown';

export interface IPublicVideoPlaybackFailure {
  kind: TPublicVideoPlaybackFailureKind;
  message: string;
  shouldRefreshAccess: boolean;
  retryWhenOnline: boolean;
  ignored: boolean;
}

/**
 * Classifica MediaError sem depender do DOM, permitindo testes determinísticos.
 *
 * Códigos HTMLMediaElement:
 * 1 = aborted; 2 = network; 3 = decode; 4 = source not supported.
 */
export function classifyPublicVideoPlaybackFailure(
  mediaErrorCode: number | null | undefined,
  online: boolean
): IPublicVideoPlaybackFailure {
  if (!online) {
    return {
      kind: 'offline',
      message: 'Você está sem conexão. O vídeo será recarregado quando a internet voltar.',
      shouldRefreshAccess: false,
      retryWhenOnline: true,
      ignored: false,
    };
  }

  switch (Number(mediaErrorCode ?? 0)) {
    case 1:
      return {
        kind: 'aborted',
        message: '',
        shouldRefreshAccess: false,
        retryWhenOnline: false,
        ignored: true,
      };

    case 2:
      return {
        kind: 'network',
        message: 'A conexão com o vídeo foi interrompida. Estamos atualizando o acesso.',
        shouldRefreshAccess: true,
        retryWhenOnline: false,
        ignored: false,
      };

    case 3:
      return {
        kind: 'decode',
        message: 'Este vídeo não pôde ser decodificado pelo navegador. Tente outro navegador ou envie o conteúdo novamente.',
        shouldRefreshAccess: false,
        retryWhenOnline: false,
        ignored: false,
      };

    case 4:
      return {
        kind: 'source',
        message: 'A fonte do vídeo não está disponível ou não é compatível. Vamos tentar atualizar o acesso uma vez.',
        shouldRefreshAccess: true,
        retryWhenOnline: false,
        ignored: false,
      };

    default:
      return {
        kind: 'unknown',
        message: 'O vídeo ficou indisponível. Estamos verificando um novo acesso.',
        shouldRefreshAccess: true,
        retryWhenOnline: false,
        ignored: false,
      };
  }
}
