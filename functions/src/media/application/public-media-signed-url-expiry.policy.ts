// Compatibilidade com os consumidores públicos existentes.
// A mesma política de deadline é aplicada às mídias privadas.
export {
  resolveAuthorizedMediaSignedUrlExpiresAt as resolvePublicMediaSignedUrlExpiresAt,
} from './authorized-media-signed-url-expiry.policy';
