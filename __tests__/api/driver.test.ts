/**
 * GET /driver is public (the map shows drivers before a ride is booked). It
 * lists the drivers table of a real Postgres (PGlite) seeded by schema.sql.
 */
import { GET as drivers } from "@/app/(api)/driver+api";
import { Driver } from "@/types/type";

import { get, mockDb, rows } from "../helpers/api";
import { createTestDb } from "../helpers/testDb";

jest.mock("@/server/db", () => ({ sql: () => mockDb.current!.sql }));

const saved = {
  CLERK_JWT_KEY: process.env.CLERK_JWT_KEY,
  EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY:
    process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY,
};

beforeEach(async () => {
  mockDb.current = await createTestDb();
  // No auth is configured at all: a route that asked for a session would fail.
  delete process.env.CLERK_JWT_KEY;
  delete process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
});
afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value !== undefined) process.env[name] = value;
  }
  jest.restoreAllMocks();
});

describe("GET /driver", () => {
  it("R01: is public — lists every driver to a caller without a session", async () => {
    const res = await get(drivers, "/driver");
    expect(res.status).toBe(200);
    expect(
      res.body.data.map(
        (d: Driver) => `${d.id} ${d.first_name} ${d.last_name}`,
      ),
    ).toEqual([
      "1 James Wilson",
      "2 David Brown",
      "3 Michael Johnson",
      "4 Robert Garcia",
      "5 Daniel Martinez",
    ]);
  });

  it("sends the Driver wire shape (NUMERIC rating as a string, like Neon)", async () => {
    const { body } = await get(drivers, "/driver");
    expect(Object.keys(body)).toEqual(["data"]);
    expect(body.data).toHaveLength(5);
    expect(body.data[2]).toEqual({
      id: 3,
      first_name: "Michael",
      last_name: "Johnson",
      profile_image_url: "https://randomuser.me/api/portraits/men/12.jpg",
      car_image_url: "https://placehold.co/320x180/png?text=Hatch",
      car_seats: 4,
      rating: "4.9",
    });
  });

  it("orders drivers by id, not by where Postgres happens to store them", async () => {
    await rows`INSERT INTO drivers (id, first_name, last_name, car_seats, rating)
      VALUES (0, 'Ana', 'Horvat', 4, 5.0)`;
    // Guard: without ORDER BY, the new row comes last.
    expect((await rows`SELECT id FROM drivers`).map((r) => r.id)).toEqual([
      1, 2, 3, 4, 5, 0,
    ]);
    const { body } = await get(drivers, "/driver");
    expect(body.data.map((d: Driver) => d.id)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(body.data[0]).toMatchObject({ first_name: "Ana", rating: "5.0" });
  });

  it("E7: answers a generic 500 when the database fails, leaking nothing (the log keeps the cause)", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    const cause = new Error("password authentication failed for user neondb");
    mockDb.current!.sql = async () => {
      throw cause;
    };
    const res = await get(drivers, "/driver");
    expect(res).toEqual({
      status: 500,
      body: {
        error: "Something went wrong on our side. Please try again later.",
      },
    });
    expect(log).toHaveBeenCalledWith("Unhandled API error:", cause);
  });
});
