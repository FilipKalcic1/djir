import { Redirect } from "expo-router";
import React from "react";

/**
 * Screens behind this gate need a signed-in rider: a signed-out deep link
 * (e.g. djir://book-ride) lands on the welcome screen instead (R53).
 */
const AuthGate = ({
  isSignedIn,
  children,
}: {
  isSignedIn: boolean | undefined;
  children: React.ReactNode;
}) => (isSignedIn ? <>{children}</> : <Redirect href="/(auth)/welcome" />);

export default AuthGate;
