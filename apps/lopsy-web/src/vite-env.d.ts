/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Photonamous' URL, for handoffs. Defaults to http://localhost:5174/ in dev and /photos/ in production. */
  readonly VITE_PHOTOS_URL?: string;
}

declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}
