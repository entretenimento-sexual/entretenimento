import { IUserSocialLinks } from 'src/app/core/interfaces/interfaces-user-dados/iuser-social-links';

export type ProfileSocialLinkKey = keyof IUserSocialLinks;

export interface ProfileSocialLinkField {
  readonly key: ProfileSocialLinkKey;
  readonly label: string;
  readonly icon: string;
  readonly placeholder: string;
}

export const PROFILE_SOCIAL_LINK_FIELDS: readonly ProfileSocialLinkField[] =
  Object.freeze([
    {
      key: 'facebook',
      label: 'Facebook',
      icon: 'fab fa-facebook-square',
      placeholder: 'perfil ou URL',
    },
    {
      key: 'instagram',
      label: 'Instagram',
      icon: 'fab fa-instagram',
      placeholder: '@usuario ou URL',
    },
    {
      key: 'twitter',
      label: 'X',
      icon: 'fab fa-x-twitter',
      placeholder: '@usuario ou URL',
    },
    {
      key: 'linkedin',
      label: 'LinkedIn',
      icon: 'fab fa-linkedin',
      placeholder: 'perfil ou URL',
    },
    {
      key: 'youtube',
      label: 'YouTube',
      icon: 'fab fa-youtube',
      placeholder: 'canal ou URL',
    },
    {
      key: 'tiktok',
      label: 'TikTok',
      icon: 'fab fa-tiktok',
      placeholder: '@usuario ou URL',
    },
    {
      key: 'snapchat',
      label: 'Snapchat',
      icon: 'fab fa-snapchat-ghost',
      placeholder: 'usuario ou URL',
    },
    {
      key: 'sexlog',
      label: 'Sexlog',
      icon: 'fas fa-link',
      placeholder: 'perfil ou URL',
    },
    {
      key: 'd4swing',
      label: 'D4',
      icon: 'fas fa-link',
      placeholder: 'perfil ou URL',
    },
    {
      key: 'hotvips',
      label: 'Hotvips',
      icon: 'fas fa-link',
      placeholder: 'URL do perfil',
    },
    {
      key: 'privacy',
      label: 'Privacy',
      icon: 'fas fa-link',
      placeholder: 'perfil ou URL',
    },
    {
      key: 'onlyfans',
      label: 'OnlyFans',
      icon: 'fas fa-link',
      placeholder: 'perfil ou URL',
    },
    {
      key: 'fansly',
      label: 'Fansly',
      icon: 'fas fa-link',
      placeholder: 'perfil ou URL',
    },
    {
      key: 'linktree',
      label: 'Linktree',
      icon: 'fas fa-link',
      placeholder: 'URL pública',
    },
  ] satisfies readonly ProfileSocialLinkField[]);
