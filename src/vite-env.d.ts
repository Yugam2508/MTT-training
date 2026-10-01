/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Cloud API endpoint override, e.g. /api/main to test a production build against the local API. */
  readonly VITE_API_URL?: string;
  readonly VITE_CLOUD?: string;
  readonly VITE_SITE_URL?: string;
}
