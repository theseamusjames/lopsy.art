/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Photonamous' URL, for handoffs (https://photonamous.com/ when deployed). Without it Lopsy offers no handoff. */
  readonly VITE_PHOTONAMOUS_URL?: string;
}

declare module '*.module.css' {
  const classes: { readonly [key: string]: string };
  export default classes;
}
