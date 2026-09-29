import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import CustomButton from "@/components/CustomButton";
import {
  AppKeyCheck,
  ENV_FILE,
  KeyStatus,
  SERVER_SETTINGS,
  ServerSettingName,
} from "@/lib/setup";
import { fetchServerHealth, ServerHealth } from "@/services/setup";

const STATUS_TEXT: Record<KeyStatus, string> = {
  set: "Set",
  missing: "Missing",
  invalid: "Not a valid key",
};

/** Red for what blocks the app, amber for what only turns a feature off. */
const statusClass = (status: KeyStatus, required: boolean) =>
  status === "set"
    ? "text-success-700"
    : required
      ? "text-danger-700"
      : "text-warning-700";

const KeyRow = ({ name, required, unlocks, source, status }: AppKeyCheck) => (
  <View
    testID={`setup-key-${name}`}
    className="rounded-2xl bg-general-500 p-4 mb-3"
  >
    <Text selectable className="text-sm font-JakartaBold text-black">
      {name}
    </Text>
    <Text
      testID={`setup-key-${name}-status`}
      className={`text-sm font-JakartaSemiBold mt-1 ${statusClass(status, required)}`}
    >
      {`${required ? "Required" : "Optional"} · ${STATUS_TEXT[status]}`}
    </Text>
    <Text className="text-sm font-Jakarta text-secondary-800 mt-1">
      {unlocks}
    </Text>
    {status !== "set" && (
      <Text className="text-xs font-Jakarta text-secondary-700 mt-1">
        {source}
      </Text>
    )}
  </View>
);

const SettingRow = ({
  name,
  unlocks,
  missing,
}: {
  name: ServerSettingName;
  unlocks: string;
  missing: boolean;
}) => (
  <View
    testID={`setup-server-${name}`}
    className="rounded-2xl bg-general-500 p-4 mb-3"
  >
    <Text selectable className="text-sm font-JakartaBold text-black">
      {name}
    </Text>
    <Text
      testID={`setup-server-${name}-status`}
      className={`text-sm font-JakartaSemiBold mt-1 ${missing ? "text-danger-700" : "text-success-700"}`}
    >
      {missing ? "Missing" : "Set"}
    </Text>
    {missing && (
      <Text className="text-sm font-Jakarta text-secondary-800 mt-1">
        {unlocks}
      </Text>
    )}
  </View>
);

const ServerSettings = ({ health }: { health: ServerHealth | null }) => {
  if (health === null) {
    return (
      <View
        testID="setup-server-checking"
        className="flex-row items-center py-2"
      >
        <ActivityIndicator />
        <Text className="text-base font-JakartaMedium text-secondary-700 ml-3">
          Checking the API…
        </Text>
      </View>
    );
  }
  if (!health.reachable) {
    return (
      <View testID="setup-server-unreachable">
        <Text className="text-base font-JakartaSemiBold text-danger-700">
          {`The API is not reachable: ${health.reason}`}
        </Text>
        <Text className="text-sm font-Jakarta text-secondary-700 mt-2">
          Keep npx expo start running on your computer, with the phone on the
          same Wi-Fi network, then tap Check again.
        </Text>
      </View>
    );
  }
  return (
    <View>
      {health.missing.length === 0 && (
        <Text
          testID="setup-server-ok"
          className="text-base font-JakartaSemiBold text-success-700 mb-3"
        >
          The API is reachable and every server setting is set.
        </Text>
      )}
      {SERVER_SETTINGS.map((setting) => (
        <SettingRow
          key={setting.name}
          {...setting}
          missing={health.missing.includes(setting.name)}
        />
      ))}
    </View>
  );
};

/**
 * What the app shows instead of crashing when it cannot start (EG1): which
 * EXPO_PUBLIC_* keys are missing or not valid, what each one unlocks, and —
 * from GET /(api)/health — which server settings are missing, or that the API
 * cannot be reached at all (EG3). Names only: never a value.
 */
const SetupNeeded = ({ checks }: { checks: AppKeyCheck[] }) => {
  const [health, setHealth] = useState<ServerHealth | null>(null);

  const check = useCallback(async () => {
    setHealth(null);
    setHealth(await fetchServerHealth());
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  return (
    <SafeAreaView testID="setup-needed" className="flex-1 bg-white">
      <ScrollView>
        <View className="px-5 py-6">
          <Text
            accessibilityRole="header"
            className="text-3xl font-JakartaBold text-black"
          >
            Setup needed
          </Text>
          <Text className="text-base font-JakartaMedium text-secondary-700 mt-2">
            {`Djir can't start yet. Add the missing keys to ${ENV_FILE} in the project folder, then stop npx expo start and run it again.`}
          </Text>

          <Text className="text-xl font-JakartaBold text-black mt-8 mb-3">
            App keys
          </Text>
          {checks.map((keyCheck) => (
            <KeyRow key={keyCheck.name} {...keyCheck} />
          ))}

          <Text className="text-xl font-JakartaBold text-black mt-8">
            Server settings
          </Text>
          <Text className="text-sm font-Jakarta text-secondary-700 mt-1 mb-3">
            {`Read by the API routes from the same ${ENV_FILE}; the app asks /(api)/health which ones are missing.`}
          </Text>
          <ServerSettings health={health} />

          <CustomButton
            testID="setup-check-again"
            title="Check again"
            className="mt-8"
            loading={health === null}
            onPress={check}
          />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

export default SetupNeeded;
