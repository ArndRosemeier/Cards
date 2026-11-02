/// <reference types="vite/client" />
interface ImportMetaEnv { readonly VITE_GAMEHUB_KEY: string; readonly VITE_GAMEHUB_URL?: string }
interface ImportMeta { readonly env: ImportMetaEnv }
