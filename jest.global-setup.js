// Run every test in a timezone far from Zagreb, so any accidental use of the
// device clock (getHours, getDay, toLocaleString…) fails loudly instead of
// passing only on a developer machine in Europe. This must run in the parent
// process (globalSetup), before Jest spawns workers: each test file gets its
// own copy of `process.env`, so setting TZ inside a test would have no effect.
module.exports = () => {
  process.env.TZ = "America/Los_Angeles";
};
