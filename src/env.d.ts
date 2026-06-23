/// <reference types="astro/client" />

interface Env {
  EMAILS: import('@cloudflare/workers-types').KVNamespace;
  RESEND_API_KEY: string;
  SITE_PASSWORD?: string;
}

type Runtime = import('@astrojs/cloudflare').Runtime<Env>;

declare namespace App {
  interface Locals extends Runtime {}
}
