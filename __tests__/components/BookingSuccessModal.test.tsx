/**
 * The booking success modal: Figma 13 after a ride now, the WP4 "Ride
 * scheduled" variant, and the rule that a paid booking is never dismissed by a
 * stray tap (no backdrop dismiss; Android back means Back Home).
 */
import {
  act,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react-native";
import { Image, Modal } from "react-native";
import palette from "tailwindcss/colors";

import BookingSuccessModal from "@/components/BookingSuccessModal";
import { images } from "@/constants";

import { colors } from "../helpers/tokens";

const NOW = Date.parse("2026-10-03T19:00:00.000Z"); // Saturday 21:00 in Zagreb
const TOMORROW_8 = Date.parse("2026-10-04T06:00:00.000Z"); // Sunday 08:00
const TUESDAY_8 = Date.parse("2026-10-06T06:00:00.000Z"); // Tuesday 08:00

// A fixed clock for the pickup sentence.
beforeEach(() => {
  jest.useFakeTimers({ now: NOW });
});

afterEach(() => {
  jest.useRealTimers();
});

function renderModal(
  props: Partial<React.ComponentProps<typeof BookingSuccessModal>> = {},
) {
  const onOpenRide = jest.fn();
  const onBackHome = jest.fn();
  render(
    <BookingSuccessModal
      visible
      driverFirstName="Michael"
      scheduledAt={null}
      nowMs={NOW}
      onOpenRide={onOpenRide}
      onBackHome={onBackHome}
      {...props}
    />,
  );
  return { onOpenRide, onBackHome };
}

describe("BookingSuccessModal — a ride now (Figma 13)", () => {
  it("F7: shows the check image, 'Booking placed successfully' and the thank-you body (Figma 13)", () => {
    renderModal();

    const modal = screen.getByTestId("booking-success");
    expect(within(modal).getByRole("header")).toHaveTextContent(
      "Booking placed successfully",
    );
    expect(
      within(modal).getByText(
        "Thank you for your booking! Your reservation has been successfully placed. Please proceed with your trip.",
      ),
    ).toHaveStyle({ color: colors.general["200"] });
    expect(within(modal).UNSAFE_getByType(Image).props.source).toBe(
      images.check,
    );
    expect(screen.queryByTestId("booking-success-scheduled")).toBeNull();
  });

  it("F7: Go Track is the primary button and opens the ride (Figma 13)", () => {
    const { onOpenRide, onBackHome } = renderModal();

    const goTrack = screen.getByTestId("booking-success-go-track");
    fireEvent.press(goTrack);

    expect(goTrack).toHaveTextContent("Go Track");
    expect(goTrack).toHaveStyle({ backgroundColor: colors.primary["500"] });
    expect(onOpenRide).toHaveBeenCalledTimes(1);
    expect(onBackHome).not.toHaveBeenCalled();
  });

  it("F7: Back Home is the light variant (general-500, black text) and goes home (Figma 13)", () => {
    const { onOpenRide, onBackHome } = renderModal();

    const backHome = screen.getByTestId("booking-success-back-home");
    fireEvent.press(backHome);

    expect(backHome).toHaveStyle({ backgroundColor: colors.general["500"] });
    expect(within(backHome).getByText("Back Home")).toHaveStyle({
      color: palette.black,
    });
    expect(onBackHome).toHaveBeenCalledTimes(1);
    expect(onOpenRide).not.toHaveBeenCalled();
  });

  it("shows nothing while not visible", () => {
    renderModal({ visible: false });

    expect(screen.queryByTestId("booking-success")).toBeNull();
    expect(screen.queryByTestId("booking-success-back-home")).toBeNull();
  });
});

describe("BookingSuccessModal — a scheduled ride (WP4)", () => {
  it("W7: shows 'Ride scheduled' with the pickup and free cancellation", () => {
    renderModal({ scheduledAt: TOMORROW_8 });

    const modal = screen.getByTestId("booking-success-scheduled");
    expect(within(modal).getByRole("header")).toHaveTextContent(
      "Ride scheduled",
    );
    expect(
      within(modal).getByText(
        "Michael will pick you up tomorrow at 08:00. Free cancellation until your driver sets off.",
      ),
    ).toBeOnTheScreen();
    expect(screen.queryByTestId("booking-success")).toBeNull();
    expect(screen.queryByText("Booking placed successfully")).toBeNull();
  });

  it("names the day when the pickup is later in the week", () => {
    renderModal({ scheduledAt: TUESDAY_8, driverFirstName: "Ana" });

    expect(
      screen.getByText(
        "Ana will pick you up on Tue 6 Oct at 08:00. Free cancellation until your driver sets off.",
      ),
    ).toBeOnTheScreen();
  });

  it("W7: offers View ride (primary) in place of Go Track, and it opens the ride", () => {
    const { onOpenRide, onBackHome } = renderModal({ scheduledAt: TOMORROW_8 });

    const viewRide = screen.getByTestId("booking-success-view-ride");
    fireEvent.press(viewRide);

    expect(viewRide).toHaveTextContent("View ride");
    expect(viewRide).toHaveStyle({ backgroundColor: colors.primary["500"] });
    expect(screen.queryByTestId("booking-success-go-track")).toBeNull();
    expect(onOpenRide).toHaveBeenCalledTimes(1);
    expect(onBackHome).not.toHaveBeenCalled();
  });

  it("W7: Back Home is the light variant and goes home", () => {
    const { onBackHome } = renderModal({ scheduledAt: TOMORROW_8 });

    const backHome = screen.getByTestId("booking-success-back-home");
    fireEvent.press(backHome);

    expect(backHome).toHaveStyle({ backgroundColor: colors.general["500"] });
    expect(onBackHome).toHaveBeenCalledTimes(1);
  });
});

describe("BookingSuccessModal — no accidental dismiss", () => {
  it.each([
    ["a ride now", null, "booking-success"],
    ["a scheduled ride", TOMORROW_8, "booking-success-scheduled"],
  ])(
    "F7 W7: tapping the backdrop of %s does nothing",
    (_, scheduledAt, testID) => {
      const { onOpenRide, onBackHome } = renderModal({ scheduledAt });

      fireEvent.press(screen.getByTestId("modal-backdrop"));

      expect(onBackHome).not.toHaveBeenCalled();
      expect(onOpenRide).not.toHaveBeenCalled();
      expect(screen.getByTestId(testID)).toBeOnTheScreen();
    },
  );

  it("F7 W7: Android back means Back Home", () => {
    const { onOpenRide, onBackHome } = renderModal();

    // The native Modal's own handler: what Android's back button calls.
    act(() => screen.UNSAFE_getByType(Modal).props.onRequestClose());

    expect(onBackHome).toHaveBeenCalledTimes(1);
    expect(onOpenRide).not.toHaveBeenCalled();
  });
});
