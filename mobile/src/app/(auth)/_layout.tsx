import { colors } from "@/lib/colors";
import { useSessionStore } from "@/stores/session";
import { Redirect, Stack, useGlobalSearchParams } from "expo-router";

export default function AuthLayout() {
  const status = useSessionStore((s) => s.status);
  const params = useGlobalSearchParams<{ redirect?: string | string[] }>();
  const redirectRaw = params.redirect;
  const redirect = Array.isArray(redirectRaw) ? redirectRaw[0] : redirectRaw;

  if (status === "authed") {
    const target =
      typeof redirect === "string" && redirect.startsWith("/") ? redirect : "/home";
    return <Redirect href={target as never} />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background }
      }}
    />
  );
}
