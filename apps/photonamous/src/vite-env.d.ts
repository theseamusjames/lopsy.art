/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** OAuth client ID for Google sign-in. Without it the app offers local storage only. */
  readonly VITE_GOOGLE_CLIENT_ID?: string;
  /** API key for the Google Picker (Add from Google Drive). */
  readonly VITE_GOOGLE_API_KEY?: string;
  /** Cloud project number; the Picker's app ID. */
  readonly VITE_GOOGLE_APP_ID?: string;
  /** `true` offers libraries on this computer (this browser, a folder) in a production build too; development always does. */
  readonly VITE_LOCAL_LIBRARIES?: string;
  /** Google Tag Manager container ID (`GTM-…`): turns usage statistics on. Unset in development and in tests. */
  readonly VITE_TAG_MANAGER_ID?: string;
  /** Lopsy's URL, for handoffs. Defaults to http://localhost:5173/ in development and https://lopsy.art/ in a build. */
  readonly VITE_LOPSY_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
