/**
 * Volta à origem canônica do perfil, sem transformar o UID visitado em
 * uma rota de edição do perfil próprio. Reutilizado nas galerias de mídia.
 */
export function visitedProfileReturnRoute(
  ownerUid: string | null | undefined,
  viewerUid: string | null | undefined
): string[] {
  const owner = String(ownerUid ?? '').trim();
  const viewer = String(viewerUid ?? '').trim();

  if (!owner) {
    return ['/dashboard/explorar'];
  }

  return owner === viewer
    ? ['/perfil']
    : ['/outro-perfil', owner];
}
