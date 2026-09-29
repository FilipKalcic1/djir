import { Image, Text, View } from "react-native";
import { ReactNativeModal } from "react-native-modal";

import CustomButton from "@/components/CustomButton";
import { images } from "@/constants";
import { pickupSentence } from "@/lib/schedule";

interface BookingSuccessModalProps {
  visible: boolean;
  driverFirstName: string;
  /** Epoch ms of a scheduled pickup, or null for a ride now. */
  scheduledAt: number | null;
  nowMs: number;
  /** Opens the booked ride: live tracking, or the scheduled ride's page. */
  onOpenRide: () => void;
  onBackHome: () => void;
}

/**
 * Figma 13 after a ride now ("Go Track"), or the scheduled variant ("View
 * ride", with the free-cancellation note). A paid booking must not be
 * dismissed by a stray tap: no backdrop dismiss, and Android back means Back
 * Home.
 */
const BookingSuccessModal = ({
  visible,
  driverFirstName,
  scheduledAt,
  nowMs,
  onOpenRide,
  onBackHome,
}: BookingSuccessModalProps) => {
  const scheduled = scheduledAt !== null;
  return (
    <ReactNativeModal isVisible={visible} onBackButtonPress={onBackHome}>
      <View
        testID={scheduled ? "booking-success-scheduled" : "booking-success"}
        className="flex flex-col items-center justify-center bg-white p-7 rounded-2xl"
      >
        <Image source={images.check} className="w-28 h-28 mt-5" />
        <Text
          accessibilityRole="header"
          className="text-2xl text-center font-JakartaBold mt-5"
        >
          {scheduled ? "Ride scheduled" : "Booking placed successfully"}
        </Text>
        <Text className="text-base text-general-200 font-Jakarta text-center mt-3">
          {scheduled
            ? `${driverFirstName} will pick you up ${pickupSentence(scheduledAt, nowMs)}. Free cancellation until your driver sets off.`
            : "Thank you for your booking! Your reservation has been successfully placed. Please proceed with your trip."}
        </Text>
        <CustomButton
          testID={
            scheduled ? "booking-success-view-ride" : "booking-success-go-track"
          }
          title={scheduled ? "View ride" : "Go Track"}
          className="mt-5"
          onPress={onOpenRide}
        />
        <CustomButton
          testID="booking-success-back-home"
          title="Back Home"
          bgVariant="light"
          textVariant="primary"
          className="mt-3 shadow-none"
          onPress={onBackHome}
        />
      </View>
    </ReactNativeModal>
  );
};

export default BookingSuccessModal;
