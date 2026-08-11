import { acceptHouseholdInvite } from "@/api/household";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { colors } from "@/lib/colors";
import { paths } from "@/lib/sitemap";
import { useSessionStore } from "@/stores/session";
import { toast } from "@/stores/toast";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { Users } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, View } from "react-native";

/**
 * Landing screen for household invite Universal Links / custom-scheme URLs:
 * `https://…/join/<token>` and `souskit://join/<token>`.
 */
export default function JoinHouseholdScreen() {
  const { token: rawToken } = useLocalSearchParams<{ token?: string }>();
  const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;
  const status = useSessionStore((s) => s.status);
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const attempted = useRef<string | null>(null);

  useEffect(() => {
    if (status !== "authed" || !token) return;
    const attemptKey = `${token}:${attempt}`;
    if (attempted.current === attemptKey) return;
    attempted.current = attemptKey;

    let cancelled = false;
    (async () => {
      setBusy(true);
      setError(null);
      try {
        const household = await acceptHouseholdInvite(token);
        if (cancelled) return;
        toast.success(`Joined ${household.name}. Recipes and plans are shared now.`);
        router.replace(paths.account as never);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Couldn’t join that household.");
        setBusy(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status, token, router, attempt]);

  if (status !== "authed") {
    const redirect = token ? paths.joinHousehold(token) : paths.home;
    return <Redirect href={{ pathname: "/login", params: { redirect } }} />;
  }

  if (!token) {
    return (
      <View className="flex-1 items-center justify-center gap-3 bg-background px-6">
        <Text className="text-sm text-muted-foreground">This invite link is incomplete.</Text>
        <Button onPress={() => router.replace(paths.account as never)}>Go to Account</Button>
      </View>
    );
  }

  return (
    <View className="flex-1 items-center justify-center gap-4 bg-background px-6">
      <View className="items-center justify-center rounded-full bg-secondary p-4">
        <Users size={28} color={colors.primary} />
      </View>
      <Text className="font-sans-semibold text-xl">Joining household…</Text>
      {busy ? (
        <>
          <ActivityIndicator color={colors.primary} />
          <Text className="text-center text-sm text-muted-foreground">
            Accepting your invite link.
          </Text>
        </>
      ) : null}
      {error ? (
        <>
          <Text className="text-center text-sm text-destructive">{error}</Text>
          <View className="flex-row gap-2">
            <Button
              variant="outline"
              onPress={() => router.replace(paths.account as never)}
            >
              Account
            </Button>
            <Button
              onPress={() => {
                setBusy(true);
                setError(null);
                setAttempt((n) => n + 1);
              }}
            >
              Try again
            </Button>
          </View>
        </>
      ) : null}
    </View>
  );
}
