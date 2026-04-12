/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly DEBUG?: string;
  readonly BACKEND_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
