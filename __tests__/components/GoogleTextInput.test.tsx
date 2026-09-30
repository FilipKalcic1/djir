/**
 * The From/To address field. With a Google Places key it is Google's search;
 * without one (a fresh .env.local) the search cannot run, so the rider picks
 * one of seven popular Zagreb places instead of hitting a dead end, and a
 * one-line note names the key that turns search on (W11).
 */
import {
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react-native";
import { View } from "react-native";
import palette from "tailwindcss/colors";

import GoogleTextInput from "@/components/GoogleTextInput";
import { icons } from "@/constants";

import { colors } from "../helpers/tokens";

/** The props GoogleTextInput last gave Google's search. */
const mockSearch = { props: null as Record<string, any> | null };
jest.mock("react-native-google-places-autocomplete", () => ({
  GooglePlacesAutocomplete: (props: Record<string, unknown>) => {
    mockSearch.props = props;
    const { View: MockView } = jest.requireActual("react-native");
    return <MockView testID="google-places-search" />;
  },
}));

const savedKey = process.env.EXPO_PUBLIC_PLACES_API_KEY;

/** Sets EXPO_PUBLIC_PLACES_API_KEY (undefined: unset), read on every render. */
function setPlacesKey(value: string | undefined) {
  if (value === undefined) delete process.env.EXPO_PUBLIC_PLACES_API_KEY;
  else process.env.EXPO_PUBLIC_PLACES_API_KEY = value;
}

const NOTE =
  "Search needs a Google Places key (EXPO_PUBLIC_PLACES_API_KEY) — pick a popular place.";

/** The seven places, in the order the list shows them, with their coordinates. */
const PLACES: [string, string, string, number, number][] = [
  [
    "trg-bana-jelacica",
    "Trg bana Jelačića",
    "Trg bana Jelačića, Zagreb",
    45.8131,
    15.9772,
  ],
  [
    "airport",
    "Zagreb Airport (Franjo Tuđman)",
    "Zagreb Airport (Franjo Tuđman)",
    45.7431,
    16.0689,
  ],
  [
    "glavni-kolodvor",
    "Glavni kolodvor",
    "Glavni kolodvor, Zagreb",
    45.8047,
    15.9783,
  ],
  ["jarun", "Jarun", "Jarun, Zagreb", 45.783, 15.92],
  ["maksimir", "Maksimir", "Maksimir, Zagreb", 45.826, 16.019],
  ["arena-zagreb", "Arena Zagreb", "Arena Zagreb", 45.7714, 15.9433],
  ["bundek", "Bundek", "Bundek, Zagreb", 45.7857, 15.9885],
];

function renderInput(
  props: Partial<React.ComponentProps<typeof GoogleTextInput>> = {},
) {
  const handlePress = jest.fn();
  render(
    <GoogleTextInput
      icon={icons.map}
      containerStyle="bg-neutral-100"
      handlePress={handlePress}
      {...props}
    />,
  );
  return { handlePress };
}

const picker = () => screen.getByTestId("place-picker");

beforeEach(() => {
  mockSearch.props = null;
  setPlacesKey("");
});

afterEach(() => {
  setPlacesKey(savedKey);
});

describe("GoogleTextInput — no Places key (W11)", () => {
  it.each([
    ["empty", ""],
    ["unset", undefined],
  ])(
    "W11: with the key %s, the field offers popular places and the note names the key; Google's search is not mounted",
    (_, value) => {
      setPlacesKey(value);

      renderInput();

      expect(screen.getByTestId("places-key-note")).toHaveTextContent(NOTE);
      expect(screen.getByTestId("places-key-note")).toHaveStyle({
        color: colors.general["200"],
      });
      expect(picker()).toHaveTextContent("Where do you want to go?Choose");
      expect(screen.queryByTestId("google-places-search")).toBeNull();
      expect(mockSearch.props).toBeNull();
    },
  );

  it("W11: tapping the field lists the seven popular Zagreb places, in order", () => {
    renderInput();
    expect(screen.queryByTestId("popular-places")).toBeNull();

    fireEvent.press(picker());

    const list = screen.getByTestId("popular-places");
    expect(
      within(list)
        .getAllByRole("button")
        .map((row) => row.props.accessibilityLabel),
    ).toEqual(PLACES.map(([, name]) => name));
    expect(picker()).toHaveTextContent("Where do you want to go?Close");
    expect(picker()).toHaveProp("accessibilityState", { expanded: true });
  });

  it.each(PLACES)(
    "W11: picking popular-place-%s (%s) hands the screen %p at its real coordinates %p, %p",
    (id, name, address, latitude, longitude) => {
      const { handlePress } = renderInput();

      fireEvent.press(picker());
      const row = screen.getByTestId(`popular-place-${id}`);
      expect(row).toHaveTextContent(name);
      fireEvent.press(row);

      expect(handlePress).toHaveBeenCalledTimes(1);
      expect(handlePress).toHaveBeenCalledWith({
        latitude,
        longitude,
        address,
      });
    },
  );

  it("W11: a pick closes the list and the field shows the place", () => {
    renderInput();

    fireEvent.press(picker());
    fireEvent.press(screen.getByTestId("popular-place-airport"));

    expect(screen.queryByTestId("popular-places")).toBeNull();
    expect(picker()).toHaveTextContent("Zagreb Airport (Franjo Tuđman)Choose");
    expect(picker()).toHaveProp(
      "accessibilityLabel",
      "Zagreb Airport (Franjo Tuđman). Choose a place",
    );
    expect(
      within(picker()).getByText("Zagreb Airport (Franjo Tuđman)"),
    ).toHaveStyle({ color: palette.black });
  });

  it("W11: the field starts from the screen's current address, and Close folds the list without picking", () => {
    const { handlePress } = renderInput({
      initialLocation: "Tresnjevka, Zagreb",
    });

    expect(picker()).toHaveTextContent("Tresnjevka, ZagrebChoose");
    fireEvent.press(picker());
    fireEvent.press(picker());

    expect(screen.queryByTestId("popular-places")).toBeNull();
    expect(handlePress).not.toHaveBeenCalled();
  });

  it("W11: the field is a labelled button in a rounded-xl frame", () => {
    renderInput();

    expect(picker()).toHaveProp(
      "accessibilityLabel",
      "Where do you want to go?. Choose a place",
    );
    expect(picker()).toHaveProp("accessibilityRole", "button");
    expect(screen.getByTestId("places-fallback")).toHaveStyle({
      borderTopLeftRadius: 12,
      borderBottomRightRadius: 12,
    });
  });
});

describe("GoogleTextInput — with a Places key", () => {
  beforeEach(() => {
    setPlacesKey("places-key-123");
  });

  it("uses Google's search with the key, and shows no fallback", () => {
    renderInput({ initialLocation: "Tresnjevka, Zagreb" });

    expect(screen.getByTestId("google-places-search")).toBeOnTheScreen();
    expect(mockSearch.props!.query).toEqual({
      key: "places-key-123",
      language: "en",
    });
    expect(mockSearch.props!.fetchDetails).toBe(true);
    // Its suggestion list must not be a second vertical scroller inside the
    // sheet's scroll view (a nested-VirtualizedList error on React Native 0.86).
    expect(mockSearch.props!.disableScroll).toBe(true);
    expect(mockSearch.props!.textInputProps.placeholder).toBe(
      "Tresnjevka, Zagreb",
    );
    expect(screen.queryByTestId("place-picker")).toBeNull();
    expect(screen.queryByTestId("places-key-note")).toBeNull();
  });

  it("a picked suggestion hands its description and coordinates to the screen", () => {
    const { handlePress } = renderInput();

    mockSearch.props!.onPress(
      { description: "Trg bana Jelačića, Zagreb, Croatia" },
      { geometry: { location: { lat: 45.81313, lng: 15.97715 } } },
    );

    expect(handlePress).toHaveBeenCalledWith({
      latitude: 45.81313,
      longitude: 15.97715,
      address: "Trg bana Jelačića, Zagreb, Croatia",
    });
  });

  it("a suggestion whose details did not load is ignored, never booked without coordinates", () => {
    const { handlePress } = renderInput();

    mockSearch.props!.onPress({ description: "Somewhere" }, null);

    expect(handlePress).not.toHaveBeenCalled();
  });

  it("renders the icon it is given at the left of the search", () => {
    renderInput({ icon: icons.target });

    const left = mockSearch.props!.renderLeftButton();
    const { UNSAFE_getByType } = render(<View>{left}</View>);
    expect(
      UNSAFE_getByType(jest.requireActual("react-native").Image).props.source,
    ).toBe(icons.target);
  });
});
