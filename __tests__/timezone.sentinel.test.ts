// If this fails, the America/Los_Angeles guard in jest.global-setup.js is not
// active, and tests that would catch device-clock bugs can pass by accident.
it("runs the suite in America/Los_Angeles", () => {
  expect(new Date(Date.UTC(2026, 0, 15, 12)).getHours()).toBe(4);
});
