import { sql } from "@/server/db";
import { route } from "@/server/http";

/** GET /(api)/driver — public: the drivers shown on the map. */
export const GET = route(async () => {
  const drivers = await sql()`SELECT * FROM drivers ORDER BY id`;
  return { data: drivers };
});
