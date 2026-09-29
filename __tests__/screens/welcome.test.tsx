/**
 * The onboarding screen: three slides in a horizontal, paging FlatList with
 * dots and Next / Get Started. It replaced react-native-swiper, which reads
 * ViewPropTypes — removed in React Native 0.86 — and crashed the app on launch.
 */
import {
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react-native";
import { FlatList, Image } from "react-native";
import palette from "tailwindcss/colors";

import Welcome from "@/app/(auth)/welcome";
import { images } from "@/constants";

import { resetRouter, router } from "../helpers/mocks/expo-router";
import { colors } from "../helpers/tokens";

jest.mock("expo-router", () => require("../helpers/mocks/expo-router"));

const PAGE_WIDTH = 390;

const pager = () => screen.getByTestId("onboarding-pager");
const dot = (index: number) => screen.getByTestId(`onboarding-dot-${index}`);
const button = (name: string) => screen.getByRole("button", { name });

/** Renders the screen and lays the pager out at PAGE_WIDTH. */
function renderWelcome() {
  render(<Welcome />);
  fireEvent(pager(), "layout", {
    nativeEvent: { layout: { x: 0, y: 0, width: PAGE_WIDTH, height: 600 } },
  });
}

/** A swipe that settles on `page`. */
function swipeTo(page: number) {
  fireEvent(pager(), "momentumScrollEnd", {
    nativeEvent: { contentOffset: { x: page * PAGE_WIDTH, y: 0 } },
  });
}

/** Which dot is lit: primary-500 for the page shown, slate-200 for the rest. */
function expectActiveDot(active: number) {
  [0, 1, 2].forEach((index) =>
    expect(dot(index)).toHaveStyle({
      backgroundColor:
        index === active ? colors.primary["500"] : palette.slate["200"],
    }),
  );
  expect(screen.getByTestId("onboarding-dots")).toHaveProp(
    "accessibilityLabel",
    `Page ${active + 1} of 3`,
  );
}

let scrollToOffset: jest.SpyInstance;

beforeEach(() => {
  resetRouter();
  scrollToOffset = jest
    .spyOn(FlatList.prototype, "scrollToOffset")
    .mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("welcome — the onboarding pager", () => {
  it("is a horizontal FlatList that pages one slide at a time", () => {
    renderWelcome();

    const list = screen.UNSAFE_getByType(FlatList);
    expect(list.props.testID).toBe("onboarding-pager");
    expect(list.props.horizontal).toBe(true);
    expect(list.props.pagingEnabled).toBe(true);
    expect(list.props.showsHorizontalScrollIndicator).toBe(false);
  });

  it.each([
    [
      1,
      "The perfect ride is just a tap away!",
      "Your journey begins with Djir. Find your ideal ride effortlessly.",
      images.onboarding1,
    ],
    [
      2,
      "Best car in your hands with Djir",
      "Discover the convenience of finding your perfect ride with Djir",
      images.onboarding2,
    ],
    [
      3,
      "Your ride, your way. Let's go!",
      "Enter your destination, sit back, and let us take care of the rest.",
      images.onboarding3,
    ],
  ])(
    "slide %p keeps its copy and image, and is one page wide",
    (id, title, description, image) => {
      renderWelcome();

      const slide = screen.getByTestId(`onboarding-slide-${id}`);
      expect(within(slide).getByText(title)).toBeOnTheScreen();
      expect(within(slide).getByText(description)).toBeOnTheScreen();
      expect(within(slide).UNSAFE_getByType(Image).props.source).toBe(image);
      expect(slide).toHaveStyle({ width: PAGE_WIDTH });
    },
  );

  it("opens on the first slide: the first dot lit and 'Next'", () => {
    renderWelcome();

    expectActiveDot(0);
    expect(button("Next")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "Get Started" })).toBeNull();
  });

  it("Next scrolls exactly one page and the dots follow; on the last slide it reads 'Get Started'", () => {
    renderWelcome();

    fireEvent.press(button("Next"));
    expect(scrollToOffset).toHaveBeenLastCalledWith({
      offset: PAGE_WIDTH,
      animated: true,
    });
    expectActiveDot(1);

    fireEvent.press(button("Next"));
    expect(scrollToOffset).toHaveBeenLastCalledWith({
      offset: 2 * PAGE_WIDTH,
      animated: true,
    });
    expectActiveDot(2);
    expect(button("Get Started")).toBeOnTheScreen();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("a swipe moves the dots and the button with it, both ways", () => {
    renderWelcome();

    swipeTo(2);
    expectActiveDot(2);
    expect(button("Get Started")).toBeOnTheScreen();

    swipeTo(1);
    expectActiveDot(1);
    expect(button("Next")).toBeOnTheScreen();
    expect(scrollToOffset).not.toHaveBeenCalled();
  });

  it("an overscroll past either end keeps a real page lit", () => {
    renderWelcome();

    fireEvent(pager(), "momentumScrollEnd", {
      nativeEvent: { contentOffset: { x: 3.4 * PAGE_WIDTH, y: 0 } },
    });
    expectActiveDot(2);

    fireEvent(pager(), "momentumScrollEnd", {
      nativeEvent: { contentOffset: { x: -0.6 * PAGE_WIDTH, y: 0 } },
    });
    expectActiveDot(0);
  });

  it("Get Started on the last slide goes to sign-up in place of onboarding", () => {
    renderWelcome();
    swipeTo(2);

    fireEvent.press(button("Get Started"));

    expect(router.replace).toHaveBeenCalledTimes(1);
    expect(router.replace).toHaveBeenCalledWith("/(auth)/sign-up");
    expect(router.push).not.toHaveBeenCalled();
  });

  it("Skip goes straight to sign-up from any slide", () => {
    renderWelcome();

    fireEvent.press(button("Skip"));

    expect(router.replace).toHaveBeenCalledWith("/(auth)/sign-up");
    expect(scrollToOffset).not.toHaveBeenCalled();
  });
});
