import { ActivityIndicator, Text, View } from "react-native";

import CustomButton from "@/components/CustomButton";
import { describePickup } from "@/lib/schedule";
import { serverNow } from "@/services/clock";
import { LoadStatus } from "@/types/type";

/** Quote states Q1–Q4 above the list; a scheduled pickup replaces per-driver ETAs. */
const QuoteSummary = ({
  status,
  error,
  surgeMultiplier,
  scheduledAt,
  onRetry,
}: {
  status: LoadStatus;
  error: string | null;
  surgeMultiplier: number | null;
  scheduledAt: number | null;
  onRetry: () => void;
}) => (
  <View className="mb-3">
    {scheduledAt !== null && (
      <Text testID="quote-pickup" className="text-base font-JakartaSemiBold">
        Pickup · {describePickup(scheduledAt, serverNow())}
      </Text>
    )}
    {status === "loading" && (
      <View testID="quotes-loading" className="flex flex-row items-center mt-2">
        <ActivityIndicator size="small" color="black" />
        <Text className="text-base font-Jakarta text-general-200 ml-2">
          Finding prices…
        </Text>
      </View>
    )}
    {status === "error" && (
      <View testID="quotes-error" className="mt-2">
        <Text className="text-base font-JakartaSemiBold">
          Couldn't get prices
        </Text>
        {error && (
          <Text className="text-sm font-Jakarta text-general-200">{error}</Text>
        )}
        <CustomButton
          title="Retry"
          bgVariant="outline"
          textVariant="primary"
          className="mt-3 shadow-none w-1/2"
          onPress={onRetry}
        />
      </View>
    )}
    {status === "ready" && surgeMultiplier !== null && surgeMultiplier > 1 && (
      <Text
        testID="quote-surge"
        className="text-sm font-JakartaSemiBold text-warning-600 mt-1"
      >
        High demand · ×{Number(surgeMultiplier.toFixed(2))}
      </Text>
    )}
  </View>
);

export default QuoteSummary;
