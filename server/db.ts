/**
 * server/db.ts — the Neon Postgres client, created on first use.
 *
 * Routes only use the tagged-template form (`sql()\`SELECT … ${value}\``), so
 * values are always sent as parameters. Tests swap this module for a PGlite
 * database with the same interface (__tests__/helpers/testDb.ts).
 */

import { neon } from "@neondatabase/serverless";

import { requireEnv } from "@/server/http";

export type Sql = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Record<string, any>[]>;

let client: Sql | null = null;

export function sql(): Sql {
  client ??= neon(
    requireEnv(process.env.DATABASE_URL, "DATABASE_URL"),
  ) as unknown as Sql;
  return client;
}
