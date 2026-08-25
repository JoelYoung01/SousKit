import { AuthApiError, registerWithPassword } from "@/api/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import { APP_NAME } from "@/config";
import { stashDevOtp } from "@/lib/dev-otp";
import { Image } from "expo-image";
import { Link, useRouter } from "expo-router";
import { useState } from "react";
import { KeyboardAwareScrollView } from "@/components/ui/keyboard";
import { View } from "react-native";

export default function RegisterScreen() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const onSubmit = async () => {
    if (submitting) return;
    setErrorMessage(null);

    if (password !== confirmPassword) {
      setErrorMessage("Passwords do not match.");
      return;
    }
    if (password.length < 8) {
      setErrorMessage("Password must be at least 8 characters.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await registerWithPassword({
        email: email.trim(),
        password,
        display_name: displayName.trim()
      });
      if (__DEV__ && result.dev_otp) {
        stashDevOtp(result.email || email.trim(), result.dev_otp);
      }
      router.push((result.redirect_to || "/verify-email") as never);
    } catch (err) {
      setErrorMessage(
        err instanceof AuthApiError || err instanceof Error
          ? err.message
          : "Could not create account"
      );
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
            style={{ width: 64, height: 64 }}
            contentFit="contain"
          />
          <Text className="font-sans-bold text-3xl tracking-tight">{APP_NAME}</Text>
          <Text className="max-w-xs text-center text-sm text-muted-foreground">
            Create an account to save and plan recipes.
          </Text>
        </View>

        <View className="w-full max-w-[320px] gap-3">
          <View className="gap-1.5">
            <Label>Display name</Label>
            <Input
              value={displayName}
              onChangeText={setDisplayName}
              autoComplete="name"
              maxLength={100}
              className="h-11"
            />
          </View>
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
            <Label>Password</Label>
            <Input
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoComplete="new-password"
              className="h-11"
            />
          </View>
          <View className="gap-1.5">
            <Label>Confirm password</Label>
            <Input
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              secureTextEntry
              autoComplete="new-password"
              className="h-11"
              onSubmitEditing={onSubmit}
              returnKeyType="go"
            />
          </View>
          {errorMessage ? <Text className="text-sm text-destructive">{errorMessage}</Text> : null}
          <Button className="h-11 w-full" onPress={onSubmit} disabled={submitting}>
            {submitting ? "Creating account…" : "Create account"}
          </Button>
          <View className="flex-row justify-center gap-1">
            <Text className="text-sm text-muted-foreground">Already have an account?</Text>
            <Link href="/login" asChild>
              <Text className="text-sm text-[#22c55e]">Sign in</Text>
            </Link>
          </View>
        </View>
    </KeyboardAwareScrollView>
  );
}
