/** The history badge (the Badge column of the build plan's H1–H5 table). */
import { render, screen } from "@testing-library/react-native";

import RideStatusBadge from "@/components/RideStatusBadge";

import { colors } from "../helpers/tokens";

describe("RideStatusBadge", () => {
  it.each([
    ["H1", "live", "Live", colors.general["400"]],
    ["H2", "upcoming", "Upcoming", colors.primary["500"]],
    ["H4", "cancelled", "Cancelled", colors.danger["600"]],
  ] as const)(
    "%s: the %s badge reads %p in white on its token colour",
    (_, badge, label, background) => {
      render(<RideStatusBadge badge={badge} />);

      const pill = screen.getByTestId(`ride-badge-${badge}`);
      expect(pill).toHaveTextContent(label);
      expect(pill).toHaveStyle({ backgroundColor: background });
      expect(screen.getByText(label)).toHaveStyle({ color: "#fff" });
    },
  );

  it("H3/H5: a completed or legacy ride has no badge", () => {
    render(<RideStatusBadge badge={null} />);

    expect(screen.toJSON()).toBeNull();
  });
});
