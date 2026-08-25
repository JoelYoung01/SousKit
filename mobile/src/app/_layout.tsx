import "../global.css";

import { AppLockGate } from "@/components/AppLockGate";
import { Toaster } from "@/components/Toaster";
import { KeyboardProvider } from "@/components/ui/keyboard";
import { colors } from "@/lib/colors";
import { queryClient } from "@/lib/query-client";
import { useAppLockStore } from "@/stores/app-lock";
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
  const appLockReady = useAppLockStore((s) => s.ready);

  useEffect(() => {
    void useSessionStore.getState().bootstrap();
    void useAppLockStore.getState().bootstrap();
  }, []);

  // Refetch stale queries when the app returns to the foreground.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (status) => {
      if (Platform.OS !== "web") focusManager.setFocused(status === "active");
    });
    return () => sub.remove();
  }, []);

  // Hold the splash screen until the lock preference is known so locked
  // content never flashes before the gate mounts.
  const ready = fontsLoaded && sessionStatus !== "loading" && appLockReady;

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
            <AppLockGate />
            <Toaster />
          </KeyboardProvider>
        </SafeAreaProvider>
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
}
