import { Text, View } from "react-native";

import { RideBadge } from "@/lib/rides";

const STYLE: Record<
  Exclude<RideBadge, null>,
  { label: string; box: string; text: string }
> = {
  live: { label: "Live", box: "bg-general-400", text: "text-white" },
  upcoming: { label: "Upcoming", box: "bg-primary-500", text: "text-white" },
  cancelled: { label: "Cancelled", box: "bg-danger-600", text: "text-white" },
};

/** "Live" · "Upcoming" · "Cancelled" — completed rides carry no badge (Figma 15). */
const RideStatusBadge = ({ badge }: { badge: RideBadge }) => {
  if (!badge) return null;
  const style = STYLE[badge];
  return (
    <View
      testID={`ride-badge-${badge}`}
      className={`self-start rounded-full px-3 py-1 ${style.box}`}
    >
      <Text className={`text-xs font-JakartaBold ${style.text}`}>
        {style.label}
      </Text>
    </View>
  );
};

export default RideStatusBadge;
