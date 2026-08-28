// src/app/core/interfaces/interfaces-user-dados/iuser-social-links.ts
export interface IUserSocialLinks {
  [key: string]: string | undefined;

  facebook?: string;
  instagram?: string;
  twitter?: string;
  linkedin?: string;
  youtube?: string;
  tiktok?: string;
  snapchat?: string;

  sexlog?: string;
  d4swing?: string;

  // ✅ novo
  hotvips?: string;

  // ✅ sugestões “semelhantes”
  privacy?: string;
  onlyfans?: string;
  fansly?: string;
  linktree?: string;
}
