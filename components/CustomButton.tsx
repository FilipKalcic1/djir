import { ActivityIndicator, Text, TouchableOpacity } from "react-native";

import { ButtonProps } from "@/types/type";

const BG = {
  primary: "bg-primary-500",
  secondary: "bg-gray-500",
  danger: "bg-red-500",
  success: "bg-green-500",
  outline: "bg-transparent border-neutral-300 border-[0.5px]",
  light: "bg-general-500",
} as const;

const TEXT = {
  default: "text-white",
  primary: "text-black",
  secondary: "text-gray-100",
  danger: "text-red-100",
  success: "text-green-100",
} as const;

const CustomButton = ({
  onPress,
  title,
  bgVariant = "primary",
  textVariant = "default",
  IconLeft,
  IconRight,
  className = "",
  loading = false,
  disabled = false,
  ...props
}: ButtonProps) => {
  const inactive = disabled || loading;
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={title}
      accessibilityState={{ disabled: inactive, busy: loading }}
      className={`w-full rounded-full p-3 flex flex-row justify-center items-center shadow-md shadow-neutral-400/70 ${BG[bgVariant]} ${inactive ? "opacity-50" : ""} ${className}`}
      {...props}
    >
      {IconLeft && <IconLeft />}
      {loading ? (
        <ActivityIndicator
          color={textVariant === "default" ? "white" : "black"}
        />
      ) : (
        <Text className={`text-lg font-JakartaBold ${TEXT[textVariant]}`}>
          {title}
        </Text>
      )}
      {IconRight && <IconRight />}
    </TouchableOpacity>
  );
};

export default CustomButton;
