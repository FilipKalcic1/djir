/**
 * A real Postgres (PGlite, in-process WASM — no Docker) behind the same
 * tagged-template interface as server/db.ts, so SQL is tested for real:
 * ON CONFLICT semantics, CHECK constraints, type parsing, the migration.
 */
import { readFileSync } from "fs";
import { join } from "path";

import { PGlite } from "@electric-sql/pglite";

import { REPO_ROOT } from "./repo";

import type { Sql } from "@/server/db";

export const readSql = (path: string) =>
  readFileSync(join(REPO_ROOT, path), "utf8");

export interface TestDb {
  db: PGlite;
  sql: Sql;
}

export async function createTestDb(schemaPath = "schema.sql"): Promise<TestDb> {
  const db = new PGlite();
  await db.exec(readSql(schemaPath));
  const sql: Sql = async (strings, ...values) => {
    const text = strings.reduce(
      (acc, part, i) => acc + (i > 0 ? `$${i}` : "") + part,
      "",
    );
    const result = await db.query<Record<string, any>>(text, values as any[]);
    return result.rows;
  };
  return { db, sql };
}
