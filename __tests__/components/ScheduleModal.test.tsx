/**
 * The "Schedule a ride" picker (WP4 Rules K1–K2, K5/K6 notices, K10 sessions,
 * Surfaces, R74), on fixed Zagreb clocks. react-native-modal is replaced by a plain container that
 * renders its children while visible and exposes the backdrop and the Android
 * back button, so the picker's own behaviour is what is under test.
 */
import {
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react-native";
import tailwindColors from "tailwindcss/colors";

import ScheduleModal from "@/components/ScheduleModal";

import { colors } from "../helpers/tokens";

jest.mock("react-native-modal", () =>
  require("../helpers/mocks/react-native-modal"),
);

const SUMMER_8AM = Date.parse("2026-09-29T06:00:00.000Z"); // Tue 29 Sep, 08:00 CEST
const WINTER_8AM = Date.parse("2026-12-01T07:00:00.000Z"); // Tue 1 Dec, 08:00 CET
const BEFORE_FALL_BACK = Date.parse("2026-10-22T06:00:00.000Z"); // Thu 22 Oct, 08:00 CEST

const slotId = (iso: string) => `schedule-slot-${iso}`;

function renderModal(
  props: Partial<React.ComponentProps<typeof ScheduleModal>> = {},
) {
  const all = {
    visible: true,
    nowMs: SUMMER_8AM,
    value: null,
    onConfirm: jest.fn(),
    onClose: jest.fn(),
    ...props,
  };
  const view = render(<ScheduleModal {...all} />);
  return {
    ...all,
    rerender: (next: Partial<React.ComponentProps<typeof ScheduleModal>>) =>
      view.rerender(<ScheduleModal {...all} {...next} />),
  };
}

const confirm = () => fireEvent.press(screen.getByTestId("schedule-confirm"));

describe("ScheduleModal — K1/K2: the slots on offer", () => {
  it("K1: at 08:00 in Zagreb the first slot is 08:30 — a slot exactly 30 min away is included", () => {
    const { onConfirm } = renderModal();

    fireEvent.press(screen.getByTestId("schedule-day-2026-09-29"));

    const slots = within(screen.getByTestId("schedule-slots")).getAllByRole(
      "radio",
    );
    expect(slots[0]).toHaveTextContent("08:30");
    expect(slots[0].props.testID).toBe(slotId("2026-09-29T06:30:00.000Z"));
    expect(screen.queryByTestId(slotId("2026-09-29T06:15:00.000Z"))).toBeNull();
    confirm();
    expect(onConfirm).toHaveBeenCalledWith(
      Date.parse("2026-09-29T06:30:00.000Z"),
    );
  });

  it("K1: one second after 08:00 the first slot is 08:45", () => {
    renderModal({ nowMs: SUMMER_8AM + 1000 });

    fireEvent.press(screen.getByTestId("schedule-day-2026-09-29"));

    const slots = within(screen.getByTestId("schedule-slots")).getAllByRole(
      "radio",
    );
    expect(slots[0]).toHaveTextContent("08:45");
    expect(screen.queryByTestId(slotId("2026-09-29T06:30:00.000Z"))).toBeNull();
  });

  it("the chips read Now, Today, Tomorrow, then 'Sat 3 Oct' style, one per Zagreb day up to 7 days ahead", () => {
    renderModal();

    const chips = screen.getAllByRole("radio");

    expect(chips.map((chip) => chip.props.testID)).toEqual([
      "schedule-chip-now",
      "schedule-day-2026-09-29",
      "schedule-day-2026-09-30",
      "schedule-day-2026-10-01",
      "schedule-day-2026-10-02",
      "schedule-day-2026-10-03",
      "schedule-day-2026-10-04",
      "schedule-day-2026-10-05",
      "schedule-day-2026-10-06",
    ]);
    expect(
      chips.map((chip) => within(chip).getByText(/./).props.children),
    ).toEqual([
      "Now",
      "Today",
      "Tomorrow",
      "Thu 1 Oct",
      "Fri 2 Oct",
      "Sat 3 Oct",
      "Sun 4 Oct",
      "Mon 5 Oct",
      "Tue 6 Oct",
    ]);
  });

  it("K2: on 25 Oct 2026 the repeated hour is offered twice, as '02:15 CEST' and '02:15 CET', among 100 slots", () => {
    renderModal({ nowMs: BEFORE_FALL_BACK });

    fireEvent.press(screen.getByTestId("schedule-day-2026-10-25"));

    const slots = within(screen.getByTestId("schedule-slots")).getAllByRole(
      "radio",
    );
    expect(slots).toHaveLength(100);
    expect(
      screen.getByTestId(slotId("2026-10-25T00:15:00.000Z")),
    ).toHaveTextContent("02:15 CEST");
    expect(
      screen.getByTestId(slotId("2026-10-25T01:15:00.000Z")),
    ).toHaveTextContent("02:15 CET");
    expect(
      screen.getByTestId(slotId("2026-10-24T23:15:00.000Z")),
    ).toHaveTextContent(/^01:15$/);
  });

  it("K2: the zone caption follows the chosen side of the repeated hour", () => {
    renderModal({ nowMs: BEFORE_FALL_BACK });
    fireEvent.press(screen.getByTestId("schedule-day-2026-10-25"));

    fireEvent.press(screen.getByTestId(slotId("2026-10-25T01:15:00.000Z")));
    expect(screen.getByText("Times in Zagreb (CET)")).toBeOnTheScreen();

    fireEvent.press(screen.getByTestId(slotId("2026-10-25T00:15:00.000Z")));
    expect(screen.getByText("Times in Zagreb (CEST)")).toBeOnTheScreen();
  });
});

describe("ScheduleModal — choosing a time", () => {
  it("choosing a day selects its first slot, and Set pickup time confirms it in epoch ms", () => {
    const { onConfirm } = renderModal();

    fireEvent.press(screen.getByTestId("schedule-day-2026-10-03"));

    const first = screen.getByTestId(slotId("2026-10-02T22:00:00.000Z"));
    expect(first).toHaveTextContent("00:00");
    expect(first).toBeChecked();
    expect(screen.getByTestId("schedule-confirm")).toHaveTextContent(
      "Set pickup time",
    );
    confirm();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledWith(
      Date.parse("2026-10-02T22:00:00.000Z"),
    );
  });

  it("tapping a slot chip selects it, and only it", () => {
    const { onConfirm } = renderModal();
    fireEvent.press(screen.getByTestId("schedule-day-2026-09-29"));

    fireEvent.press(screen.getByTestId(slotId("2026-09-29T06:45:00.000Z")));

    expect(
      screen.getByTestId(slotId("2026-09-29T06:45:00.000Z")),
    ).toBeChecked();
    expect(
      screen.getByTestId(slotId("2026-09-29T06:30:00.000Z")),
    ).not.toBeChecked();
    confirm();
    expect(onConfirm).toHaveBeenCalledWith(
      Date.parse("2026-09-29T06:45:00.000Z"),
    );
  });

  it("tapping the day that already holds the chosen slot keeps that slot", () => {
    const { onConfirm } = renderModal();
    fireEvent.press(screen.getByTestId("schedule-day-2026-09-30"));
    fireEvent.press(screen.getByTestId(slotId("2026-09-30T16:00:00.000Z")));

    fireEvent.press(screen.getByTestId("schedule-day-2026-09-30"));

    confirm();
    expect(onConfirm).toHaveBeenCalledWith(
      Date.parse("2026-09-30T16:00:00.000Z"),
    );
  });

  it("switching days shows only the new day's slots", () => {
    renderModal();
    fireEvent.press(screen.getByTestId("schedule-day-2026-09-29"));

    fireEvent.press(screen.getByTestId("schedule-day-2026-09-30"));

    const slots = within(screen.getByTestId("schedule-slots")).getAllByRole(
      "radio",
    );
    expect(slots).toHaveLength(96);
    expect(slots[0].props.testID).toBe(slotId("2026-09-29T22:00:00.000Z"));
    expect(screen.queryByTestId(slotId("2026-09-29T06:30:00.000Z"))).toBeNull();
  });

  it("W4: the Now chip turns the button into 'Ride now', hides the slots and confirms null", () => {
    const value = Date.parse("2026-09-30T06:00:00.000Z");
    const { onConfirm } = renderModal({ value });

    fireEvent.press(screen.getByTestId("schedule-chip-now"));

    expect(screen.getByTestId("schedule-confirm")).toHaveTextContent(
      "Ride now",
    );
    expect(screen.queryByTestId("schedule-slots")).toBeNull();
    confirm();
    expect(onConfirm).toHaveBeenCalledWith(null);
  });

  it("with Now chosen no day chip is selected and no slots are shown", () => {
    renderModal();

    expect(screen.getByTestId("schedule-chip-now")).toBeChecked();
    expect(screen.getByTestId("schedule-day-2026-09-29")).not.toBeChecked();
    expect(screen.queryByTestId("schedule-slots")).toBeNull();
    expect(screen.getByTestId("schedule-confirm")).toHaveTextContent(
      "Ride now",
    );
  });

  it("a slot value preselects its day and its slot", () => {
    const value = Date.parse("2026-10-03T06:00:00.000Z"); // Sat 3 Oct, 08:00
    const { onConfirm } = renderModal({ value });

    expect(screen.getByTestId("schedule-day-2026-10-03")).toBeChecked();
    expect(screen.getByTestId("schedule-day-2026-09-29")).not.toBeChecked();
    expect(screen.getByTestId("schedule-chip-now")).not.toBeChecked();
    expect(
      screen.getByTestId(slotId("2026-10-03T06:00:00.000Z")),
    ).toBeChecked();
    confirm();
    expect(onConfirm).toHaveBeenCalledWith(value);
  });

  it("reopening (visible false → true) resets the choice to value", () => {
    const { rerender, onConfirm } = renderModal();
    fireEvent.press(screen.getByTestId("schedule-day-2026-10-03"));

    rerender({ visible: false });
    expect(screen.queryByTestId("schedule-modal")).toBeNull();
    rerender({ visible: true });

    expect(screen.getByTestId("schedule-chip-now")).toBeChecked();
    expect(screen.getByTestId("schedule-day-2026-10-03")).not.toBeChecked();
    expect(screen.queryByTestId("schedule-slots")).toBeNull();
    confirm();
    expect(onConfirm).toHaveBeenCalledWith(null);
  });

  it("K10: a new nowMs while the picker is open keeps the rider's choice", () => {
    const { rerender, onConfirm } = renderModal();
    fireEvent.press(screen.getByTestId("schedule-day-2026-10-03"));
    fireEvent.press(screen.getByTestId(slotId("2026-10-03T06:00:00.000Z")));

    rerender({ nowMs: SUMMER_8AM + 60_000 });
    rerender({ nowMs: SUMMER_8AM + 2 * 60_000 });

    expect(screen.getByTestId("schedule-day-2026-10-03")).toBeChecked();
    expect(
      screen.getByTestId(slotId("2026-10-03T06:00:00.000Z")),
    ).toBeChecked();
    confirm();
    expect(onConfirm).toHaveBeenCalledWith(
      Date.parse("2026-10-03T06:00:00.000Z"),
    );
  });

  it("K10: a new value while the picker is open keeps the rider's choice too", () => {
    const { rerender, onConfirm } = renderModal();
    fireEvent.press(screen.getByTestId("schedule-day-2026-09-30"));

    rerender({ value: Date.parse("2026-10-01T16:30:00.000Z") });

    confirm();
    expect(onConfirm).toHaveBeenCalledWith(
      Date.parse("2026-09-29T22:00:00.000Z"),
    );
  });

  it("K10: the grid is the one from the opening; the next opening reads the clock again", () => {
    const { rerender } = renderModal();
    fireEvent.press(screen.getByTestId("schedule-day-2026-09-29"));

    rerender({ nowMs: SUMMER_8AM + 20 * 60_000 });
    expect(
      screen.getByTestId(slotId("2026-09-29T06:30:00.000Z")),
    ).toBeOnTheScreen();

    rerender({ visible: false, nowMs: SUMMER_8AM + 20 * 60_000 });
    rerender({ visible: true, nowMs: SUMMER_8AM + 20 * 60_000 });
    fireEvent.press(screen.getByTestId("schedule-day-2026-09-29"));

    expect(screen.queryByTestId(slotId("2026-09-29T06:30:00.000Z"))).toBeNull();
    expect(
      within(screen.getByTestId("schedule-slots")).getAllByRole("radio")[0],
    ).toHaveTextContent("09:00");
  });

  it("K10: opening with a time no longer on offer preselects the earliest slot, never an invisible one", () => {
    const stale = Date.parse("2026-09-29T06:15:00.000Z"); // 08:15, inside the 30-min lead
    const { onConfirm } = renderModal({ value: stale });

    expect(screen.getByTestId("schedule-day-2026-09-29")).toBeChecked();
    expect(
      screen.getByTestId(slotId("2026-09-29T06:30:00.000Z")),
    ).toBeChecked();
    expect(screen.getByTestId("schedule-confirm")).toHaveTextContent(
      "Set pickup time",
    );
    confirm();
    expect(onConfirm).toHaveBeenCalledWith(
      Date.parse("2026-09-29T06:30:00.000Z"),
    );
  });

  it("reopening with a new value selects that value's day", () => {
    const { rerender, onConfirm } = renderModal();
    const value = Date.parse("2026-10-01T16:30:00.000Z"); // Thu 1 Oct, 18:30

    rerender({ visible: false });
    rerender({ visible: true, value });

    expect(screen.getByTestId("schedule-day-2026-10-01")).toBeChecked();
    expect(
      screen.getByTestId(slotId("2026-10-01T16:30:00.000Z")),
    ).toBeChecked();
    confirm();
    expect(onConfirm).toHaveBeenCalledWith(value);
  });
});

describe("ScheduleModal — K5/K6: why it opened", () => {
  it("W8 K5 K6: a notice is shown at the top of the picker (schedule-modal-notice), in text-warning-700", () => {
    renderModal({
      notice: "That pickup time is no longer available — choose a new time",
    });

    const notice = screen.getByTestId("schedule-modal-notice");
    expect(notice).toHaveTextContent(
      "That pickup time is no longer available — choose a new time",
    );
    expect(notice).toHaveStyle({ color: colors.warning["700"] });
    expect(notice).toHaveProp("accessibilityLiveRegion", "polite");
  });

  it("W8 K5 K6: without a notice there is no notice line", () => {
    renderModal();

    expect(screen.queryByTestId("schedule-modal-notice")).toBeNull();
  });

  it("K5 K6: opened with a notice (the rider's time was refused), it starts on the earliest slot, not on Now", () => {
    const { onConfirm } = renderModal({
      value: null,
      notice: "That pickup time is no longer available — choose a new time",
    });

    expect(screen.getByTestId("schedule-chip-now")).not.toBeChecked();
    expect(screen.getByTestId("schedule-day-2026-09-29")).toBeChecked();
    expect(
      screen.getByTestId(slotId("2026-09-29T06:30:00.000Z")),
    ).toBeChecked();
    expect(screen.getByTestId("schedule-confirm")).toHaveTextContent(
      "Set pickup time",
    );
    confirm();
    expect(onConfirm).toHaveBeenCalledWith(
      Date.parse("2026-09-29T06:30:00.000Z"),
    );
  });

  it("K5 K6: with a notice, a value still on offer is kept", () => {
    const value = Date.parse("2026-10-01T16:30:00.000Z");

    renderModal({ value, notice: "That pickup time is no longer available" });

    expect(
      screen.getByTestId(slotId("2026-10-01T16:30:00.000Z")),
    ).toBeChecked();
  });
});

describe("ScheduleModal — surfaces and tokens", () => {
  it("shows the 'Schedule a ride' header", () => {
    renderModal();

    expect(screen.getByRole("header")).toHaveTextContent("Schedule a ride");
  });

  it("W2: a selected chip is bg-primary-500 with text-white; an unselected one is bg-general-500 with text-black", () => {
    renderModal();

    expect(screen.getByTestId("schedule-chip-now")).toHaveStyle({
      backgroundColor: colors.primary["500"],
    });
    expect(screen.getByText("Now")).toHaveStyle({
      color: tailwindColors.white,
    });
    expect(screen.getByTestId("schedule-day-2026-09-30")).toHaveStyle({
      backgroundColor: colors.general["500"],
    });
    expect(screen.getByText("Tomorrow")).toHaveStyle({
      color: tailwindColors.black,
    });
  });

  it("W3: a selected slot chip is bg-primary-500, its neighbours bg-general-500", () => {
    renderModal({ value: Date.parse("2026-09-29T07:00:00.000Z") });

    expect(screen.getByTestId(slotId("2026-09-29T07:00:00.000Z"))).toHaveStyle({
      backgroundColor: colors.primary["500"],
    });
    expect(screen.getByText("09:00")).toHaveStyle({
      color: tailwindColors.white,
    });
    expect(screen.getByTestId(slotId("2026-09-29T07:15:00.000Z"))).toHaveStyle({
      backgroundColor: colors.general["500"],
    });
    expect(screen.getByText("09:15")).toHaveStyle({
      color: tailwindColors.black,
    });
  });

  it("W4: Set pickup time is a primary button (bg-primary-500)", () => {
    renderModal();

    expect(screen.getByTestId("schedule-confirm")).toHaveStyle({
      backgroundColor: colors.primary["500"],
    });
  });

  it("W2 R74: chips are radios that expose their checked state", () => {
    renderModal();

    expect(
      screen.getByRole("radio", { name: "Now", checked: true }),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole("radio", { name: "Today", checked: false }),
    ).toBeOnTheScreen();

    fireEvent.press(screen.getByRole("radio", { name: "Today" }));

    expect(
      screen.getByRole("radio", { name: "Today", checked: true }),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole("radio", { name: "Now", checked: false }),
    ).toBeOnTheScreen();
    expect(
      screen.getByRole("radio", { name: "08:30", checked: true }),
    ).toBeOnTheScreen();
  });

  it("the caption reads 'Times in Zagreb (CEST)' in summer", () => {
    renderModal({ nowMs: SUMMER_8AM });

    expect(screen.getByText("Times in Zagreb (CEST)")).toBeOnTheScreen();
  });

  it("the caption reads 'Times in Zagreb (CET)' in winter", () => {
    renderModal({ nowMs: WINTER_8AM });

    expect(screen.getByText("Times in Zagreb (CET)")).toBeOnTheScreen();
  });
});

describe("ScheduleModal — closing", () => {
  it("R74: the ✕ button reaches past its glyph — a hitSlop of 12 on every side", () => {
    renderModal();

    expect(screen.getByRole("button", { name: "Close" })).toHaveProp(
      "hitSlop",
      { top: 12, bottom: 12, left: 12, right: 12 },
    );
  });

  it("R74: the ✕ button is labelled 'Close' and closes without confirming", () => {
    const { onClose, onConfirm } = renderModal();

    fireEvent.press(screen.getByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("tapping the backdrop closes", () => {
    const { onClose, onConfirm } = renderModal();

    fireEvent.press(screen.getByTestId("modal-backdrop"));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("the Android back button closes", () => {
    const { onClose } = renderModal();

    fireEvent.press(screen.getByTestId("modal-back-button"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
