/**
 * components/Map (the native booking map) as a plain View, so a screen can be
 * rendered without react-native-maps:
 * `jest.mock("@/components/Map", () => require("../helpers/mocks/booking-map"))`.
 */
import { View } from "react-native";

const BookingMap = () => <View testID="booking-map" />;

export default BookingMap;
