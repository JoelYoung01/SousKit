import { AuthApiError, resendVerificationEmail, verifyEmailOtp } from "@/api/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import { APP_NAME } from "@/config";
import { clearDevOtp, readDevOtp, stashDevOtp } from "@/lib/dev-otp";
import { useSessionStore } from "@/stores/session";
import { Image } from "expo-image";
import { useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { KeyboardAwareScrollView } from "@/components/ui/keyboard";
import { View } from "react-native";

export default function VerifyEmailScreen() {
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(typeof params.email === "string" ? params.email : "");
  const [otp, setOtp] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [resending, setResending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [devOtpHint, setDevOtpHint] = useState<string | null>(() =>
    __DEV__ && typeof params.email === "string" && params.email ? readDevOtp(params.email) : null
  );

  // Follow ?email= updates via the adjust-state-in-render pattern.
  const [seenEmailParam, setSeenEmailParam] = useState(params.email);
  if (params.email !== seenEmailParam) {
    setSeenEmailParam(params.email);
    if (typeof params.email === "string" && params.email) {
      setEmail(params.email);
      if (__DEV__) setDevOtpHint(readDevOtp(params.email));
    }
  }

  const onSubmit = async () => {
    if (submitting) return;
    setErrorMessage(null);
    setInfoMessage(null);
    setSubmitting(true);
    try {
      const payload = await verifyEmailOtp({ email: email.trim(), otp: otp.trim() });
      clearDevOtp(email.trim());
      await useSessionStore.getState().setSession(payload.access_token, payload.user);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Verification failed");
    } finally {
      setSubmitting(false);
    }
  };

  const onResend = async () => {
    if (resending || !email.trim()) return;
    setErrorMessage(null);
    setInfoMessage(null);
    setResending(true);
    try {
      const result = await resendVerificationEmail(email.trim());
      setInfoMessage(result.message);
      if (result.dev_otp) {
        setDevOtpHint(result.dev_otp);
        stashDevOtp(result.email || email.trim(), result.dev_otp);
      }
    } catch (err) {
      setErrorMessage(
        err instanceof AuthApiError || err instanceof Error
          ? err.message
          : "Could not resend code"
      );
    } finally {
      setResending(false);
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
            style={{ width: 64, height: 64 }}
            contentFit="contain"
          />
          <Text className="font-sans-bold text-3xl tracking-tight">{APP_NAME}</Text>
          <Text className="max-w-sm text-center text-sm text-muted-foreground">
            Enter the 6-digit code we sent to your email to finish creating your account.
          </Text>
        </View>

        <View className="w-full max-w-[320px] gap-3">
          <View className="gap-1.5">
            <Label>Email</Label>
            <Input
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              className="h-11"
            />
          </View>
          <View className="gap-1.5">
            <Label>Verification code</Label>
            <Input
              value={otp}
              onChangeText={setOtp}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              textContentType="oneTimeCode"
              maxLength={12}
              placeholder="123456"
              className="h-11 tracking-[4px]"
              onSubmitEditing={onSubmit}
              returnKeyType="go"
            />
          </View>
          {errorMessage ? <Text className="text-sm text-destructive">{errorMessage}</Text> : null}
          {infoMessage ? <Text className="text-sm text-muted-foreground">{infoMessage}</Text> : null}
          {__DEV__ && devOtpHint ? (
            <View className="rounded-md border border-border bg-muted/40 px-3 py-2">
              <Text className="text-xs text-faint">
                Dev OTP: <Text className="text-xs text-foreground">{devOtpHint}</Text>
              </Text>
            </View>
          ) : null}
          <Button className="h-11 w-full" onPress={onSubmit} disabled={submitting}>
            {submitting ? "Verifying…" : "Verify email"}
          </Button>
          <Button
            variant="outline"
            className="h-11 w-full"
            onPress={onResend}
            disabled={resending || !email.trim()}
          >
            {resending ? "Sending…" : "Resend code"}
          </Button>
        </View>
    </KeyboardAwareScrollView>
  );
}
