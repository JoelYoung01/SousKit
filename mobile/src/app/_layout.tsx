import "../global.css";

import { Toaster } from "@/components/Toaster";
import { KeyboardProvider } from "@/components/ui/keyboard";
import { colors } from "@/lib/colors";
import { queryClient } from "@/lib/query-client";
import { useSessionStore } from "@/stores/session";
import {
  Figtree_400Regular,
  Figtree_500Medium,
  Figtree_600SemiBold,
  Figtree_700Bold,
  useFonts
} from "@expo-google-fonts/figtree";
import { focusManager, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { AppState, Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { SafeAreaProvider } from "react-native-safe-area-context";

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    Figtree_400Regular,
    Figtree_500Medium,
    Figtree_600SemiBold,
    Figtree_700Bold
  });
  const sessionStatus = useSessionStore((s) => s.status);

  useEffect(() => {
    void useSessionStore.getState().bootstrap();
  }, []);

  // Refetch stale queries and reset the 30-day session idle window whenever
  // the app is actually in use. This does not show a sign-in prompt.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (status) => {
      if (Platform.OS !== "web") focusManager.setFocused(status === "active");
      if (status === "active") void useSessionStore.getState().touch();
    });
    return () => sub.remove();
  }, []);

  const ready = fontsLoaded && sessionStatus !== "loading";

  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  return (
    <QueryClientProvider client={queryClient}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <SafeAreaProvider>
          <KeyboardProvider>
            <StatusBar style="light" />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.background }
              }}
            />
            <Toaster />
          </KeyboardProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
}
