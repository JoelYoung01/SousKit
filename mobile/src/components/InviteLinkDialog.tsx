import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { colors } from "@/lib/colors";
import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { ActivityIndicator, Modal, Pressable, Share, View } from "react-native";
import QRCode from "react-native-qrcode-svg";

type Props = {
  visible: boolean;
  inviteUrl: string | null;
  loading?: boolean;
  onClose: () => void;
  onCopied?: () => void;
  onShared?: () => void;
  onError?: (message: string) => void;
};

/** Modal showing a household invite QR code + copy/share actions. */
export function InviteLinkDialog({
  visible,
  inviteUrl,
  loading = false,
  onClose,
  onCopied,
  onShared,
  onError
}: Props) {
  const [copying, setCopying] = useState(false);

  async function copyLink() {
    if (!inviteUrl || copying) return;
    setCopying(true);
    try {
      await Clipboard.setStringAsync(inviteUrl);
      onCopied?.();
    } catch {
      onError?.("Couldn’t copy the invite link.");
    } finally {
      setCopying(false);
    }
  }

  async function shareLink() {
    if (!inviteUrl) return;
    try {
      await Share.share({
        message: `Join my Sous Kit household:\n${inviteUrl}`,
        url: inviteUrl
      });
      onShared?.();
    } catch {
      onError?.("Couldn’t share the invite link.");
    }
  }

  return (
    <Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
      <View className="flex-1 items-center justify-center bg-black/60 px-6">
        <Pressable className="absolute inset-0" onPress={onClose} accessibilityLabel="Close" />
        <View className="w-full max-w-sm rounded-xl border border-border bg-card p-5">
          <Text className="font-sans-semibold text-lg">Invite to household</Text>
          <Text className="mt-2 text-sm leading-5 text-muted-foreground">
            Scan the QR code or copy the single-use link. Opens the Sous Kit app when installed,
            otherwise the web app.
          </Text>

          <View className="mt-5 items-center justify-center rounded-xl bg-white p-4">
            {loading || !inviteUrl ? (
              <View className="h-[200px] w-[200px] items-center justify-center">
                <ActivityIndicator color={colors.primary} />
              </View>
            ) : (
              <QRCode
                value={inviteUrl}
                size={200}
                backgroundColor="#ffffff"
                color="#090b09"
              />
            )}
          </View>

          {inviteUrl ? (
            <Text
              className="mt-3 text-center text-xs text-muted-foreground"
              numberOfLines={2}
              selectable
            >
              {inviteUrl}
            </Text>
          ) : null}

          <View className="mt-5 gap-2">
            <Button
              disabled={!inviteUrl || copying || loading}
              onPress={() => void copyLink()}
            >
              {copying ? "Copying…" : "Copy link"}
            </Button>
            <Button
              variant="outline"
              disabled={!inviteUrl || loading}
              onPress={() => void shareLink()}
            >
              Share
            </Button>
            <Button variant="ghost" onPress={onClose}>
              Done
            </Button>
          </View>
        </View>
      </View>
    </Modal>
  );
}
