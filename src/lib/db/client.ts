import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

/**
 * Neon over HTTP: each query is a fetch, which is exactly right for serverless — no pool to
 * leak, no socket to keep warm, nothing to configure on Vercel beyond DATABASE_URL.
 *
 * Deliberately NOT cached in a module-level singleton created at import time: reading the
 * env lazily keeps `next build` from needing a database just to compile pages.
 */
let cached: ReturnType<typeof create> | null = null;

function create() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL is not set — see .env.example.");
  }

  return drizzle(neon(url), { schema });
}

export function db() {
  cached ??= create();
  return cached;
}

export { schema };
