import { router, useFocusEffect } from "expo-router";
import { useCallback, useRef, useState } from "react";
import { Alert, Image, Text, View } from "react-native";

import BookingSuccessModal from "@/components/BookingSuccessModal";
import Payment from "@/components/Payment";
import RideLayout from "@/components/RideLayout";
import RouteSummary from "@/components/RouteSummary";
import { icons } from "@/constants";
import { LatLng } from "@/lib/geo";
import { reminderFor } from "@/lib/reminders";
import { trackRideHref } from "@/lib/rides";
import { describePickup } from "@/lib/schedule";
import { formatEur, formatMinutes } from "@/lib/utils";
import { serverNow } from "@/services/clock";
import { remindAbout } from "@/services/reminders";
import {
  resetBookingFlow,
  useBookingStore,
  useDriverStore,
  useLocationStore,
} from "@/store";
import { MarkerData, Ride, TripQuote } from "@/types/type";

const DetailRow = ({
  label,
  value,
  testID,
  last = false,
  valueClassName = "",
}: {
  label: string;
  value: string;
  testID?: string;
  last?: boolean;
  valueClassName?: string;
}) => (
  <View
    className={`flex flex-row items-center justify-between w-full py-3 ${last ? "" : "border-b border-white"}`}
  >
    <Text className="text-lg font-Jakarta">{label}</Text>
    <Text
      testID={testID}
      className={`text-lg font-JakartaSemiBold ${valueClassName}`}
    >
      {value}
    </Text>
  </View>
);

/** Everything Book Ride shows and pays for. */
interface Trip {
  driver: MarkerData;
  quote: TripQuote;
  origin: string;
  destination: string;
  pickup: LatLng;
  dropoff: LatLng;
}

const BookRide = () => {
  const {
    userAddress,
    destinationAddress,
    userLatitude,
    userLongitude,
    destinationLatitude,
    destinationLongitude,
  } = useLocationStore();
  const { drivers, selectedDriver, quote } = useDriverStore();
  const slotNotice = useBookingStore((s) => s.slotNotice);
  const [booked, setBooked] = useState<Ride | null>(null);
  const leaving = useRef(false);
  const shown = useRef<Trip | null>(null);

  // K6: the server refused the pickup time — back to Find ride's picker.
  // dismissTo pops back to it: since expo-router 4, navigate would push a
  // second Find ride on top of this screen.
  useFocusEffect(
    useCallback(() => {
      if (slotNotice !== null) router.dismissTo("/(root)/find-ride");
    }, [slotNotice]),
  );

  const driver = drivers.find((d) => d.id === selectedDriver);
  if (
    driver &&
    quote &&
    userAddress &&
    destinationAddress &&
    userLatitude !== null &&
    userLongitude !== null &&
    destinationLatitude !== null &&
    destinationLongitude !== null
  ) {
    shown.current = {
      driver,
      quote,
      origin: userAddress,
      destination: destinationAddress,
      pickup: { latitude: userLatitude, longitude: userLongitude },
      dropoff: {
        latitude: destinationLatitude,
        longitude: destinationLongitude,
      },
    };
  }
  // Once a trip was shown it stays while the stores change under it (a failed
  // refresh, K6 on the way back, the reset while leaving after a payment).
  const trip = shown.current;
  if (!trip) {
    // Reached without a choice (e.g. a deep link): send the rider back (R13).
    return (
      <RideLayout title="Book Ride">
        <Text className="text-lg font-JakartaSemiBold">
          Choose a driver first.
        </Text>
      </RideLayout>
    );
  }

  /** Leave the paid booking flow (it must not stay on the back stack — R16). */
  const leave = (navigate: () => void) => {
    if (leaving.current) return; // P10: a second tap navigates nowhere
    leaving.current = true;
    const ride = booked;
    router.dismissAll();
    navigate();
    // After navigating: this screen keeps showing `trip` while it animates out.
    resetBookingFlow();
    // Ask for notification permission in context, once the rider is done here (N3).
    if (ride) remindAbout(reminderFor(ride, serverNow())).catch(() => {});
  };

  return (
    <RideLayout title="Book Ride">
      <Text className="text-xl font-JakartaSemiBold mb-3">
        Ride Information
      </Text>

      <View className="flex flex-col w-full items-center justify-center mt-10">
        <Image
          source={{ uri: trip.driver.profile_image_url ?? undefined }}
          className="w-28 h-28 rounded-full"
          accessibilityLabel={trip.driver.title}
        />
        <View className="flex flex-row items-center justify-center mt-5 space-x-2">
          <Text className="text-lg font-JakartaSemiBold">
            {trip.driver.title}
          </Text>
          <View className="flex flex-row items-center space-x-0.5">
            <Image
              source={icons.star}
              className="w-5 h-5"
              resizeMode="contain"
            />
            <Text className="text-lg font-Jakarta">
              {Number(trip.driver.rating).toFixed(1)}
            </Text>
          </View>
        </View>
      </View>

      <View className="flex flex-col w-full items-start justify-center py-3 px-5 rounded-3xl bg-general-600 mt-5">
        <DetailRow
          label="Ride Price"
          testID="book-fare"
          value={formatEur(trip.quote.fareCents / 100)}
          valueClassName="text-general-400"
        />
        <DetailRow
          label="Pickup time"
          testID="book-pickup-time"
          value={
            trip.quote.scheduledAt === null
              ? `In ${formatMinutes(trip.driver.pickupMinutes)}`
              : describePickup(trip.quote.scheduledAt, serverNow())
          }
        />
        <DetailRow
          label="Trip time"
          value={formatMinutes(trip.quote.tripMinutes)}
        />
        <DetailRow
          label="Car Seats"
          value={String(trip.driver.car_seats)}
          last
        />
      </View>

      <Text
        testID="book-cancel-policy"
        className="text-sm font-Jakarta text-general-200 mt-3"
      >
        {trip.quote.scheduledAt === null
          ? "Rides booked for now can't be cancelled."
          : "Free cancellation until your driver sets off."}
      </Text>

      <RouteSummary origin={trip.origin} destination={trip.destination} />

      <Payment
        driverId={trip.driver.id}
        quote={trip.quote}
        pickup={trip.pickup}
        dropoff={trip.dropoff}
        originAddress={trip.origin}
        destinationAddress={trip.destination}
        onBooked={setBooked}
        onPaidUnconfirmed={() =>
          Alert.alert(
            "Payment received",
            "Your ride will appear in Rides shortly.",
            [
              {
                text: "OK",
                onPress: () =>
                  leave(() => router.navigate("/(root)/(tabs)/rides")),
              },
            ],
          )
        }
      />

      <BookingSuccessModal
        visible={booked !== null}
        driverFirstName={trip.driver.first_name}
        scheduledAt={trip.quote.scheduledAt}
        nowMs={serverNow()}
        onOpenRide={() =>
          leave(() => router.push(trackRideHref(booked!.ride_id)))
        }
        onBackHome={() => leave(() => router.navigate("/(root)/(tabs)/home"))}
      />
    </RideLayout>
  );
};

export default BookRide;
