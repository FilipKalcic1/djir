/** The shared pickup and drop-off rows (Figma 12 and 14). */
import { render, screen, within } from "@testing-library/react-native";

import RouteSummary from "@/components/RouteSummary";
import { icons } from "@/constants";

import { colors } from "../helpers/tokens";

describe("RouteSummary", () => {
  it("F5: the pickup row shows the origin next to the 'to' icon, framed in general-700 (Figma 14)", () => {
    render(
      <RouteSummary
        origin="Tresnjevka, Zagreb"
        destination="Trg bana Jelačića, Zagreb"
      />,
    );

    const origin = screen.getByTestId("route-summary-origin");
    expect(origin).toHaveTextContent("Tresnjevka, Zagreb");
    expect(within(origin).getByLabelText("Pickup")).toHaveProp(
      "source",
      icons.to,
    );
    expect(origin).toHaveStyle({
      borderTopColor: colors.general["700"],
      borderBottomColor: colors.general["700"],
    });
  });

  it("F5: the drop-off row shows the destination next to the 'point' icon, underlined in general-700 (Figma 14)", () => {
    render(
      <RouteSummary
        origin="Tresnjevka, Zagreb"
        destination="Trg bana Jelačića, Zagreb"
      />,
    );

    const destination = screen.getByTestId("route-summary-destination");
    expect(destination).toHaveTextContent("Trg bana Jelačića, Zagreb");
    expect(within(destination).getByLabelText("Drop-off")).toHaveProp(
      "source",
      icons.point,
    );
    expect(destination).toHaveStyle({
      borderBottomColor: colors.general["700"],
    });
  });

  it("shows a dash for an address that is not known yet", () => {
    render(<RouteSummary origin={null} destination={null} />);

    expect(screen.getByTestId("route-summary-origin")).toHaveTextContent("—");
    expect(screen.getByTestId("route-summary-destination")).toHaveTextContent(
      "—",
    );
  });
});
