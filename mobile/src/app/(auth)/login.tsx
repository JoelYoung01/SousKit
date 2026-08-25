import { AuthApiError, loginWithPassword } from "@/api/auth";
import { AppleLoginButton } from "@/components/AppleLoginButton";
import { GoogleLoginButton } from "@/components/GoogleLoginButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Text } from "@/components/ui/text";
import { APP_NAME } from "@/config";
import { colors } from "@/lib/colors";
import { stashDevOtp } from "@/lib/dev-otp";
import { useSessionStore } from "@/stores/session";
import { Image } from "expo-image";
import { Link, useLocalSearchParams, useRouter } from "expo-router";
import { LoaderCircle } from "lucide-react-native";
import { useState } from "react";
import { KeyboardAwareScrollView } from "@/components/ui/keyboard";
import { View } from "react-native";

export default function LoginScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ redirect?: string | string[] }>();
  const redirectRaw = params.redirect;
  const redirect = Array.isArray(redirectRaw) ? redirectRaw[0] : redirectRaw;
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [oauthPending, setOauthPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onSubmit = async () => {
    if (submitting || oauthPending) return;
    setErrorMessage(null);
    setSubmitting(true);
    try {
      const payload = await loginWithPassword({ email: email.trim(), password });
      await useSessionStore.getState().setSession(payload.access_token, payload.user);
    } catch (err) {
      if (err instanceof AuthApiError && err.redirectTo) {
        // Unverified account — server redirects to the verify screen.
        if (__DEV__ && err.devOtp) stashDevOtp(err.email || email.trim(), err.devOtp);
        router.push(err.redirectTo as never);
      } else {
        setErrorMessage(err instanceof Error ? err.message : "Login failed");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAwareScrollView
      className="flex-1 bg-background"
      contentContainerClassName="flex-grow items-center justify-center gap-8 px-6 py-10"
      keyboardShouldPersistTaps="handled"
      bottomOffset={24}
    >
        <View className="items-center gap-3">
          <Image
            source={require("@/assets/images/souskit-mark.png")}
            style={{ width: 80, height: 80 }}
            contentFit="contain"
          />
          <Text className="font-sans-bold text-3xl tracking-tight">{APP_NAME}</Text>
        </View>

        {oauthPending ? (
          <View className="w-full max-w-[320px] items-center gap-6" accessibilityLiveRegion="polite">
            <View className="items-center gap-3">
              <LoaderCircle size={32} color={colors.primary} />
              <Text className="font-sans-medium text-sm">Signing you in…</Text>
              <Text className="text-center text-xs text-muted-foreground">
                Finishing sign-in
              </Text>
            </View>
            <View className="w-full gap-3">
              <Skeleton className="h-11 w-full rounded-lg" />
              <Skeleton className="h-11 w-full rounded-lg" />
              <Skeleton className="h-11 w-full rounded-lg" />
            </View>
          </View>
        ) : (
          <>
            <View className="w-full max-w-[320px] gap-3">
              <View className="gap-1.5">
                <Label>Email</Label>
                <Input
                  value={email}
                  onChangeText={setEmail}
                  autoCapitalize="none"
                  autoComplete="email"
                  keyboardType="email-address"
                  placeholder="you@example.com"
                  className="h-11"
                />
              </View>
              <View className="gap-1.5">
                <Label>Password</Label>
                <Input
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                  autoComplete="current-password"
                  placeholder="••••••••"
                  className="h-11"
                  onSubmitEditing={onSubmit}
                  returnKeyType="go"
                />
              </View>
              {errorMessage ? (
                <Text className="text-sm text-destructive">{errorMessage}</Text>
              ) : null}
              <Button className="h-11 w-full" onPress={onSubmit} disabled={submitting}>
                {submitting ? "Signing in…" : "Sign in"}
              </Button>
              <View className="flex-row justify-center gap-1">
                <Text className="text-sm text-muted-foreground">New here?</Text>
                <Link
                  href={
                    redirect
                      ? { pathname: "/register", params: { redirect } }
                      : "/register"
                  }
                  asChild
                >
                  <Text className="text-sm text-[#22c55e]">Create an account</Text>
                </Link>
              </View>
            </View>

            <View className="w-full max-w-[320px] items-center gap-3">
              <View className="w-full flex-row items-center gap-3">
                <View className="h-px flex-1 bg-border" />
                <Text className="text-xs text-faint">or</Text>
                <View className="h-px flex-1 bg-border" />
              </View>
              <AppleLoginButton onPendingChange={setOauthPending} onError={setErrorMessage} />
              <GoogleLoginButton onPendingChange={setOauthPending} onError={setErrorMessage} />
            </View>
          </>
        )}
    </KeyboardAwareScrollView>
  );
}
