import { act, renderHook } from "@testing-library/react-native";
import * as Location from "expo-location";

import { useCurrentLocation } from "@/hooks/useCurrentLocation";
import { resetSession, useDriverStore, useLocationStore } from "@/store";

import { deferred, settle } from "../helpers/async";

jest.mock("expo-location", () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn(),
  reverseGeocodeAsync: jest.fn(),
}));

const requestPermission = jest.mocked(
  Location.requestForegroundPermissionsAsync,
);
const getPosition = jest.mocked(Location.getCurrentPositionAsync);
const reverseGeocode = jest.mocked(Location.reverseGeocodeAsync);

const COORDS = { latitude: 45.8, longitude: 15.945 };
const permission = (status: string) =>
  ({ status }) as Awaited<ReturnType<typeof requestPermission>>;
const position = { coords: COORDS } as Awaited<ReturnType<typeof getPosition>>;
const place = (fields: object) =>
  [fields] as Awaited<ReturnType<typeof reverseGeocode>>;

type Answer = ReturnType<typeof deferred<ReturnType<typeof permission>>>;

const pickup = () => {
  const { userLatitude, userLongitude, userAddress } =
    useLocationStore.getState();
  return { userLatitude, userLongitude, userAddress };
};
const NOTHING_STORED = {
  userLatitude: null,
  userLongitude: null,
  userAddress: null,
};

beforeEach(() => {
  resetSession();
  requestPermission.mockReset().mockResolvedValue(permission("granted"));
  getPosition.mockReset().mockResolvedValue(position);
  reverseGeocode
    .mockReset()
    .mockResolvedValue(place({ name: "Ozaljska 93", city: "Zagreb" }));
});

describe("useCurrentLocation", () => {
  it("R19: granted → stores the position as the pickup, labelled 'name, city', and is ready", async () => {
    const { result } = renderHook(() => useCurrentLocation());
    expect(result.current).toBe("locating");

    await settle();

    expect(getPosition).toHaveBeenCalledWith({});
    expect(reverseGeocode).toHaveBeenCalledWith(COORDS);
    expect(pickup()).toEqual({
      userLatitude: 45.8,
      userLongitude: 15.945,
      userAddress: "Ozaljska 93, Zagreb",
    });
    expect(result.current).toBe("ready");
  });

  it("R19: uses the region when the place has no city", async () => {
    reverseGeocode.mockResolvedValue(
      place({ name: "Ozaljska 93", city: null, region: "Grad Zagreb" }),
    );

    renderHook(() => useCurrentLocation());
    await settle();

    expect(pickup().userAddress).toBe("Ozaljska 93, Grad Zagreb");
  });

  it.each([
    ["no place at all", [] as Awaited<ReturnType<typeof reverseGeocode>>],
    [
      "a place with no name or area",
      place({ name: null, city: null, region: null }),
    ],
  ])(
    "R19: labels the pickup 'Current location' when the geocoder finds %s",
    async (_, places) => {
      reverseGeocode.mockResolvedValue(places);

      const { result } = renderHook(() => useCurrentLocation());
      await settle();

      expect(pickup()).toEqual({
        userLatitude: 45.8,
        userLongitude: 15.945,
        userAddress: "Current location",
      });
      expect(result.current).toBe("ready");
    },
  );

  it("R19: a failed reverse geocode still gives a usable pickup, labelled 'Current location'", async () => {
    reverseGeocode.mockRejectedValue(new Error("Geocoder unavailable"));

    const { result } = renderHook(() => useCurrentLocation());
    await settle();

    expect(pickup()).toEqual({
      userLatitude: 45.8,
      userLongitude: 15.945,
      userAddress: "Current location",
    });
    expect(result.current).toBe("ready");
  });

  it("R19: denied → 'denied', no position asked for, nothing stored", async () => {
    requestPermission.mockResolvedValue(permission("denied"));

    const { result } = renderHook(() => useCurrentLocation());
    await settle();

    expect(result.current).toBe("denied");
    expect(getPosition).not.toHaveBeenCalled();
    expect(pickup()).toEqual(NOTHING_STORED);
  });

  it("R19: a position that cannot be read → 'unavailable', nothing stored", async () => {
    getPosition.mockRejectedValue(new Error("Location services are off"));

    const { result } = renderHook(() => useCurrentLocation());
    await settle();

    expect(result.current).toBe("unavailable");
    expect(pickup()).toEqual(NOTHING_STORED);
  });

  it("R19: a permission request that fails → 'unavailable', never an endless spinner", async () => {
    requestPermission.mockRejectedValue(new Error("No activity"));

    const { result } = renderHook(() => useCurrentLocation());
    await settle();

    expect(result.current).toBe("unavailable");
    expect(pickup()).toEqual(NOTHING_STORED);
  });

  it("R19: an already known pickup is 'ready' at once, without asking for permission", async () => {
    act(() =>
      useLocationStore.getState().setUserLocation({
        latitude: 45.8131,
        longitude: 15.9772,
        address: "Trg bana Jelačića, Zagreb",
      }),
    );

    const { result } = renderHook(() => useCurrentLocation());
    expect(result.current).toBe("ready");
    await settle();

    expect(result.current).toBe("ready");
    expect(requestPermission).not.toHaveBeenCalled();
    expect(pickup().userAddress).toBe("Trg bana Jelačića, Zagreb");
  });

  it("R19: a pickup typed while still locating is kept; the late position does not overwrite it", async () => {
    let arrive!: (value: typeof position) => void;
    getPosition.mockReturnValue(new Promise((resolve) => (arrive = resolve)));
    const { result } = renderHook(() => useCurrentLocation());
    await settle();

    act(() =>
      useLocationStore.getState().setUserLocation({
        latitude: 45.8131,
        longitude: 15.9772,
        address: "Trg bana Jelačića, Zagreb",
      }),
    );
    arrive(position);
    await settle();

    expect(pickup()).toEqual({
      userLatitude: 45.8131,
      userLongitude: 15.9772,
      userAddress: "Trg bana Jelačića, Zagreb",
    });
    expect(result.current).toBe("ready");
  });

  it.each([
    ["a denial", (answer: Answer) => answer.resolve(permission("denied"))],
    ["a failure", (answer: Answer) => answer.reject(new Error("No activity"))],
  ])(
    "R19: an abandoned lookup never reports its late outcome (%s) over a fresh one",
    async (_, settleAbandoned) => {
      const abandoned = deferred<ReturnType<typeof permission>>();
      requestPermission
        .mockReturnValueOnce(abandoned.promise)
        .mockReturnValueOnce(new Promise(() => {}));
      const { result } = renderHook(() => useCurrentLocation());
      await settle();
      act(() =>
        useLocationStore.getState().setUserLocation({
          latitude: 45.8131,
          longitude: 15.9772,
          address: "Trg bana Jelačića, Zagreb",
        }),
      );
      act(() => resetSession()); // the typed pickup is cleared: locate again

      settleAbandoned(abandoned);
      await settle();

      expect(requestPermission).toHaveBeenCalledTimes(2);
      expect(result.current).toBe("locating");
    },
  );

  it("R19: unmounting before the position arrives stores nothing", async () => {
    let arrive!: (value: typeof position) => void;
    getPosition.mockReturnValue(new Promise((resolve) => (arrive = resolve)));
    act(() => useDriverStore.getState().setSelectedDriver(3));
    const { unmount } = renderHook(() => useCurrentLocation());
    await settle();

    unmount();
    arrive(position);
    await settle();

    expect(pickup()).toEqual(NOTHING_STORED);
    expect(useDriverStore.getState().selectedDriver).toBe(3); // setUserLocation never ran
  });
});
