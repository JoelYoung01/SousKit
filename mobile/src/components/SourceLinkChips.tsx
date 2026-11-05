import { Text } from "@/components/ui/text";
import { colors } from "@/lib/colors";
import { tapHaptic } from "@/lib/haptics";
import type { RecipeSourceLink } from "@/types";
import { ExternalLink } from "lucide-react-native";
import { Linking, Pressable, View } from "react-native";

export function SourceLinkChips({ links }: { links: RecipeSourceLink[] }) {
  if (!links.length) return null;

  return (
    <View className="flex-row flex-wrap gap-2">
      {links.map((link) => (
        <Pressable
          key={link.url}
          accessibilityRole="link"
          accessibilityLabel={`${link.name}. Opens ${link.url}`}
          onPress={() => {
            tapHaptic();
            Linking.openURL(link.url).catch(() => undefined);
          }}
          className="max-w-full flex-row items-center gap-1.5 rounded-full bg-secondary px-3 py-1.5 active:opacity-80"
        >
          <Text className="shrink text-sm font-sans-semibold text-[#4ade80]" numberOfLines={1}>
            {link.name}
          </Text>
          <ExternalLink size={14} color={colors.green400} />
        </Pressable>
      ))}
    </View>
  );
}
