// Compatibility export. The canonical backend rate-limit policy now lives in
// shared/security so Communities, Media and future domains use one source.
export * from '../../shared/security/backend-fixed-window-rate-limit';
