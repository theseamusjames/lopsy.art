/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** OAuth client ID for Google sign-in. Without it the app offers local storage only. */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  /** API key for the Google Picker (Add from Google Drive). */
  readonly VITE_GOOGLE_API_KEY?: string;
  /** Cloud project number; the Picker's app ID. */
  readonly VITE_GOOGLE_APP_ID?: string;
  /** Lopsy's URL, for handoffs. Defaults to this origin's root. */
  readonly VITE_LOPSY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
