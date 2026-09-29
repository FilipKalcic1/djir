/**
 * What a stubbed `global.fetch` resolves to in client tests: as much of a
 * Response as services/api.ts reads (ok, status and the body as text).
 */
export const fetchResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => JSON.stringify(body),
});
