import { createTestDb, readSql, TestDb } from "../helpers/testDb";

const MIGRATION = readSql("db/migrations/001_v1_1.sql");

/**
 * A script's statements as `psql -f` sends them: one at a time, each in its
 * own transaction (autocommit), so an early statement commits even when a
 * later one fails. Splits on `;` outside `$$` bodies, after dropping `--`
 * comments (these scripts have no `--` inside string literals).
 */
function psqlStatements(script: string): string[] {
  const statements: string[] = [];
  let current = "";
  let inDollarQuote = false;
  const code = script.replace(/--.*$/gm, "");
  for (let i = 0; i < code.length; i++) {
    if (code.startsWith("$$", i)) {
      inDollarQuote = !inDollarQuote;
      current += "$$";
      i++;
    } else if (code[i] === ";" && !inDollarQuote) {
      statements.push(current.trim());
      current = "";
    } else {
      current += code[i];
    }
  }
  return statements.filter((statement) => statement !== "");
}

/** The rides table as Postgres sees it: columns, constraints, indexes. */
async function describeRides({ sql }: TestDb) {
  const columns = await sql`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = current_schema() AND table_name = 'rides'
    ORDER BY column_name`;
  const constraints = await sql`
    SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint
    WHERE conrelid = 'rides'::regclass ORDER BY conname`;
  const indexes = await sql`
    SELECT indexdef FROM pg_indexes
    WHERE schemaname = current_schema() AND tablename = 'rides'
    ORDER BY indexname`;
  return {
    columns: columns.map(
      (c) =>
        `${c.column_name}:${c.data_type}:${c.is_nullable}:${c.column_default}`,
    ),
    constraints: constraints.map((c) => `${c.conname}: ${c.definition}`),
    indexes: indexes.map((i) => i.indexdef),
  };
}

describe("R17/R76: db/migrations/001_v1_1.sql on a v1.0 database", () => {
  async function legacyDb() {
    const { db, sql } = await createTestDb(
      "__tests__/fixtures/schema-v1.0.sql",
    );
    // v1.0 stored cents in the euro column and a naive UTC timestamp.
    await db.exec(`
      INSERT INTO rides (origin_address, destination_address, origin_latitude, origin_longitude,
        destination_latitude, destination_longitude, ride_time, fare_price, payment_status,
        driver_id, user_id, created_at)
      VALUES ('A', 'B', 45.8, 15.945, 45.8085, 15.9775, 14, 773.00, 'paid', 3, 'user_1',
        '2026-09-28 22:30:00');`);
    // Any client whose session is not UTC (psql with PGTZ, a desktop tool).
    await db.exec(`SET TIME ZONE 'America/Los_Angeles';`);
    return { db, sql };
  }

  const snapshot = async (sql: Awaited<ReturnType<typeof legacyDb>>["sql"]) =>
    (await sql`SELECT fare_price, created_at FROM rides`)[0];

  it("R17 R76: converts cents to euros and keeps created_at's instant", async () => {
    const { db, sql } = await legacyDb();
    await db.exec(MIGRATION);
    const row = await snapshot(sql);
    expect(row.fare_price).toBe("7.73");
    expect(row.created_at.toISOString()).toBe("2026-09-28T22:30:00.000Z");
  });

  it("changes nothing when run a second time", async () => {
    const { db, sql } = await legacyDb();
    await db.exec(MIGRATION);
    const once = await snapshot(sql);
    await db.exec(MIGRATION);
    expect(await snapshot(sql)).toEqual(once);
  });

  it("records itself in schema_migrations, so the cents fix can never run twice", async () => {
    const { db, sql } = await legacyDb();
    await db.exec(MIGRATION);
    expect(
      (await sql`SELECT version FROM schema_migrations`).map((r) => r.version),
    ).toEqual(["001_v1_1"]);
  });

  it("does not touch fares on a database created from the v1.1 schema.sql", async () => {
    const { db, sql } = await createTestDb();
    await sql`INSERT INTO rides (origin_address, destination_address, origin_latitude, origin_longitude,
      destination_latitude, destination_longitude, ride_time, fare_price, payment_status, driver_id, user_id)
      VALUES ('A', 'B', 45.8, 15.9, 45.81, 15.97, 12, 9.74, 'paid', 1, 'user_1')`;
    await db.exec(MIGRATION);
    expect((await sql`SELECT fare_price FROM rides`)[0].fare_price).toBe(
      "9.74",
    );
  });

  it("adds the v1.1 columns and constraints", async () => {
    const { db, sql } = await legacyDb();
    await db.exec(MIGRATION);
    const columns = (
      await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'rides'`
    ).map((r) => r.column_name);
    expect(columns).toEqual(
      expect.arrayContaining([
        "payment_intent_id",
        "paid_at",
        "scheduled_at",
        "pickup_minutes",
        "cancelled_at",
        "cancel_requested_at",
        "reconciled_at",
      ]),
    );
    await expect(
      sql`UPDATE rides SET payment_status = 'bogus'`,
    ).rejects.toThrow(/rides_payment_status_check/);
  });

  it("X23: run again on a v1.1 database from before cancel_requested_at, it adds the column and keeps every ride", async () => {
    const { db, sql } = await createTestDb();
    await sql`INSERT INTO rides (origin_address, destination_address, origin_latitude, origin_longitude,
      destination_latitude, destination_longitude, ride_time, fare_price, payment_status, driver_id, user_id)
      VALUES ('A', 'B', 45.8, 15.9, 45.81, 15.97, 12, 9.74, 'paid', 1, 'user_1')`;
    await db.exec("ALTER TABLE rides DROP COLUMN cancel_requested_at");
    await db.exec(MIGRATION);
    expect(
      await sql`SELECT fare_price, payment_status, cancel_requested_at FROM rides`,
    ).toEqual([
      { fare_price: "9.74", payment_status: "paid", cancel_requested_at: null },
    ]);
  });

  it("DB1: a v1.0 payment_status outside the CHECK set ('bogus') becomes failed, so the CHECK can be added", async () => {
    const { db, sql } = await legacyDb();
    await db.exec(`
      INSERT INTO rides (origin_address, destination_address, origin_latitude, origin_longitude,
        destination_latitude, destination_longitude, ride_time, fare_price, payment_status,
        driver_id, user_id)
      VALUES ('A', 'B', 45.8, 15.945, 45.8085, 15.9775, 14, 500.00, 'bogus', 3, 'user_1');`);
    await db.exec(MIGRATION);
    expect(
      (await sql`SELECT payment_status FROM rides ORDER BY ride_id`).map(
        (r) => r.payment_status,
      ),
    ).toEqual(["paid", "failed"]);
    await expect(
      sql`UPDATE rides SET payment_status = 'bogus'`,
    ).rejects.toThrow(/rides_payment_status_check/);
  });

  it("DB2: a v1.0 row with a NULL created_at or driver_id leaves that column nullable instead of aborting", async () => {
    const { db, sql } = await legacyDb();
    await db.exec(`
      INSERT INTO rides (origin_address, destination_address, origin_latitude, origin_longitude,
        destination_latitude, destination_longitude, ride_time, fare_price, payment_status,
        driver_id, user_id, created_at)
      VALUES ('A', 'B', 45.8, 15.945, 45.8085, 15.9775, 14, 500.00, 'paid', NULL, 'user_1', NULL);`);
    await db.exec(MIGRATION);
    expect(
      (
        await sql`SELECT column_name, is_nullable FROM information_schema.columns
                  WHERE table_name = 'rides' AND column_name IN ('created_at', 'driver_id')
                  ORDER BY column_name`
      ).map((r) => `${r.column_name}:${r.is_nullable}`),
    ).toEqual(["created_at:YES", "driver_id:YES"]);
    expect(
      (await sql`SELECT version FROM schema_migrations`).map((r) => r.version),
    ).toEqual(["001_v1_1"]);
  });

  it("R17: schema.sql run by mistake on a v1.0 database (psql, autocommit) records nothing, so the migration still converts cents", async () => {
    const { db, sql } = await legacyDb();
    const failures: string[] = [];
    for (const statement of psqlStatements(readSql("schema.sql"))) {
      await db.exec(statement).catch((error: Error) => {
        failures.push(error.message);
      });
    }
    expect(failures).toEqual([
      "there is no unique or exclusion constraint matching the ON CONFLICT specification",
    ]);
    expect(await sql`SELECT version FROM schema_migrations`).toEqual([]);
    await db.exec(MIGRATION);
    expect((await snapshot(sql)).fare_price).toBe("7.73");
  });
});

describe("schema.sql (fresh install)", () => {
  it("R39: can be applied twice without duplicating the seed drivers", async () => {
    const { db, sql } = await createTestDb();
    await db.exec(readSql("schema.sql"));
    expect((await sql`SELECT count(*)::int AS n FROM drivers`)[0].n).toBe(5);
  });

  it("DB3: its rides table equals a migrated v1.0 one — column types, nullability and defaults, constraints, indexes", async () => {
    const fresh = await describeRides(await createTestDb());
    const migrated = await createTestDb("__tests__/fixtures/schema-v1.0.sql");
    await migrated.db.exec(MIGRATION);
    expect(await describeRides(migrated)).toEqual(fresh);
    // Not vacuous: the comparison sees nullability and the CHECK.
    expect(fresh.columns).toEqual(
      expect.arrayContaining([
        "created_at:timestamp with time zone:NO:now()",
        "driver_id:integer:NO:null",
        "cancel_requested_at:timestamp with time zone:YES:null",
        "reconciled_at:timestamp with time zone:YES:null",
      ]),
    );
    expect(fresh.constraints).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^rides_payment_status_check: CHECK /),
        "rides_payment_intent_id_key: UNIQUE (payment_intent_id)",
      ]),
    );
  });
});
