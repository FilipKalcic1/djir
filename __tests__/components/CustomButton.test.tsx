/**
 * CustomButton: every variant resolves to its colour token, and a loading or
 * disabled button can't be pressed and says so to assistive tech (R74).
 */
import {
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react-native";
import { ActivityIndicator, Text } from "react-native";
import palette from "tailwindcss/colors";

import CustomButton from "@/components/CustomButton";

import { colors } from "../helpers/tokens";

function renderButton(
  props: Partial<React.ComponentProps<typeof CustomButton>> = {},
) {
  const onPress = jest.fn();
  render(
    <CustomButton testID="button" title="Book" onPress={onPress} {...props} />,
  );
  return { onPress, button: screen.getByTestId("button") };
}

describe("CustomButton — variants", () => {
  it.each([
    ["primary", { backgroundColor: colors.primary["500"] }],
    ["light", { backgroundColor: colors.general["500"] }],
    ["secondary", { backgroundColor: palette.gray["500"] }],
    ["danger", { backgroundColor: palette.red["500"] }],
    ["success", { backgroundColor: palette.green["500"] }],
    [
      "outline",
      {
        backgroundColor: "transparent",
        borderTopColor: palette.neutral["300"],
        borderTopWidth: 0.5,
      },
    ],
  ] as const)("bgVariant %s resolves to %p", (bgVariant, style) => {
    const { button } = renderButton({ bgVariant });

    expect(button).toHaveStyle(style);
  });

  it("defaults to the primary background with white text", () => {
    const { button } = renderButton();

    expect(button).toHaveStyle({ backgroundColor: colors.primary["500"] });
    expect(screen.getByText("Book")).toHaveStyle({ color: palette.white });
  });

  it.each([
    ["default", palette.white],
    ["primary", palette.black],
    ["secondary", palette.gray["100"]],
    ["danger", palette.red["100"]],
    ["success", palette.green["100"]],
  ] as const)("textVariant %s colours the title %p", (textVariant, color) => {
    renderButton({ textVariant });

    expect(screen.getByText("Book")).toHaveStyle({ color });
  });

  it("renders IconLeft before and IconRight after the title", () => {
    renderButton({
      IconLeft: () => <Text>left</Text>,
      IconRight: () => <Text>right</Text>,
    });

    expect(screen.getByTestId("button")).toHaveTextContent("leftBookright");
  });
});

describe("CustomButton — pressing, loading and disabled (R74)", () => {
  it("R74: an enabled button is a labelled button, at full opacity, that calls onPress", () => {
    const { onPress, button } = renderButton();

    fireEvent.press(button);

    expect(screen.getByRole("button", { name: "Book" })).toBe(button);
    expect(button).toBeEnabled();
    expect(button).not.toBeBusy();
    expect(button).toHaveStyle({ opacity: 1 });
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("R74: disabled sets accessibilityState.disabled, dims the button and ignores presses", () => {
    const { onPress, button } = renderButton({ disabled: true });

    fireEvent.press(button);

    expect(button).toHaveProp("accessibilityState", {
      disabled: true,
      busy: false,
    });
    expect(button).toBeDisabled();
    expect(button).toHaveStyle({ opacity: 0.5 });
    expect(screen.getByText("Book")).toBeOnTheScreen();
    expect(onPress).not.toHaveBeenCalled();
  });

  it("loading swaps the title for a white spinner and disables the button", () => {
    const { onPress, button } = renderButton({ loading: true });

    fireEvent.press(button);

    expect(within(button).UNSAFE_getByType(ActivityIndicator).props.color).toBe(
      "white",
    );
    expect(screen.queryByText("Book")).toBeNull();
    expect(button).toBeDisabled();
    expect(button).toBeBusy();
    expect(button).toHaveStyle({ opacity: 0.5 });
    expect(onPress).not.toHaveBeenCalled();
  });

  it("loading on a dark-text variant shows a black spinner", () => {
    const { button } = renderButton({
      loading: true,
      bgVariant: "light",
      textVariant: "primary",
    });

    expect(within(button).UNSAFE_getByType(ActivityIndicator).props.color).toBe(
      "black",
    );
  });
});
