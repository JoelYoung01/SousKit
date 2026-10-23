import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Text } from "@/components/ui/text";
import { colors } from "@/lib/colors";
import {
  formatGroceryListPlainText,
  getExportableGroceryItems
} from "@/lib/grocery-export";
import {
  ensureRemindersPermission,
  getLastRemindersListId,
  isRemindersExportAvailable,
  listWritableReminderLists,
  pushGroceryItemsToReminders,
  type ReminderListOption
} from "@/lib/grocery-reminders";
import { tapHaptic } from "@/lib/haptics";
import { toast } from "@/stores/toast";
import type { GroceryItem } from "@/types";
import * as Clipboard from "expo-clipboard";
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  ListTodo
} from "lucide-react-native";
import { useMemo, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";

type Step = "providers" | "reminders";

type ProviderRowProps = {
  title: string;
  description: string;
  icon: typeof ClipboardCopy;
  highlighted?: boolean;
  disabled?: boolean;
  onPress: () => void;
};

function ProviderRow({
  title,
  description,
  icon: Icon,
  highlighted,
  disabled,
  onPress
}: ProviderRowProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      className={
        highlighted
          ? "flex-row items-center gap-3 rounded-lg border border-[#22c55e]/40 bg-[#22c55e]/10 px-3 py-3 active:opacity-80"
          : "flex-row items-center gap-3 rounded-lg px-3 py-3 active:bg-secondary/60"
      }
      style={disabled ? { opacity: 0.45 } : undefined}
    >
      <View
        className={
          highlighted
            ? "h-10 w-10 items-center justify-center rounded-lg bg-primary"
            : "h-10 w-10 items-center justify-center rounded-lg bg-secondary"
        }
      >
        <Icon size={19} color={colors.foreground} strokeWidth={2} />
      </View>
      <View className="min-w-0 flex-1">
        <Text className="font-sans-medium text-sm">{title}</Text>
        <Text className="mt-0.5 text-xs text-muted-foreground" numberOfLines={2}>
          {description}
        </Text>
      </View>
      <ChevronRight size={16} color={colors.faint} />
    </Pressable>
  );
}

export function GroceryExportSheet({
  visible,
  onClose,
  items
}: {
  visible: boolean;
  onClose: () => void;
  items: GroceryItem[];
}) {
  const remindersAvailable = isRemindersExportAvailable();
  const exportable = useMemo(() => getExportableGroceryItems(items), [items]);
  const exportCount = exportable.length;

  const [step, setStep] = useState<Step>("providers");
  const [copying, setCopying] = useState(false);
  const [listsLoading, setListsLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [lists, setLists] = useState<ReminderListOption[]>([]);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [listsError, setListsError] = useState<string | null>(null);

  function resetToProviders() {
    setStep("providers");
    setCopying(false);
    setListsLoading(false);
    setExporting(false);
    setLists([]);
    setSelectedListId(null);
    setListsError(null);
  }

  function handleClose() {
    resetToProviders();
    onClose();
  }

  async function onCopy() {
    if (copying) return;
    if (exportCount === 0) {
      toast.warning("There’s nothing to export.");
      return;
    }
    tapHaptic();
    setCopying(true);
    try {
      await Clipboard.setStringAsync(formatGroceryListPlainText(exportable));
      toast.success(
        exportCount === 1 ? "Copied 1 item." : `Copied ${exportCount} items.`
      );
      handleClose();
    } catch (er) {
      toast.fromError(er, "Couldn’t copy the grocery list.");
    } finally {
      setCopying(false);
    }
  }

  async function openReminders() {
    if (!remindersAvailable || listsLoading) return;
    if (exportCount === 0) {
      toast.warning("There’s nothing to export.");
      return;
    }
    tapHaptic();
    setStep("reminders");
    setListsLoading(true);
    setListsError(null);
    try {
      const permission = await ensureRemindersPermission();
      if (!permission.granted) {
        setListsError("Allow Reminders access in Settings to export the list.");
        setLists([]);
        return;
      }
      const [options, lastId] = await Promise.all([
        listWritableReminderLists(),
        getLastRemindersListId()
      ]);
      setLists(options);
      if (options.length === 0) {
        setListsError("No writable Reminders lists were found on this device.");
        setSelectedListId(null);
        return;
      }
      const preferred =
        (lastId && options.find((opt) => opt.id === lastId)?.id) || options[0]?.id || null;
      setSelectedListId(preferred);
    } catch (er) {
      setListsError(
        er instanceof Error ? er.message : "Couldn’t load Reminders lists."
      );
      setLists([]);
    } finally {
      setListsLoading(false);
    }
  }

  async function onPushToReminders() {
    if (!selectedListId || exporting) return;
    tapHaptic();
    setExporting(true);
    try {
      const result = await pushGroceryItemsToReminders(exportable, selectedListId);
      toast.success(
        result.created === 1
          ? `Added 1 item to “${result.listTitle}”.`
          : `Added ${result.created} items to “${result.listTitle}”.`
      );
      handleClose();
    } catch (er) {
      toast.fromError(er, "Couldn’t export to Reminders.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={handleClose}>
      {step === "providers" ? (
        <View className="gap-1 pb-1">
          <Text className="px-1 pb-1 font-sans-bold text-lg">Export</Text>
          <Text className="px-1 pb-3 text-sm text-muted-foreground">
            {exportCount === 0
              ? "No active items to export."
              : exportCount === 1
                ? "1 active item"
                : `${exportCount} active items`}
          </Text>

          <ProviderRow
            title="Copy list"
            description="Plain text for Notes, Messages, or anywhere else"
            icon={ClipboardCopy}
            highlighted
            disabled={copying || exportCount === 0}
            onPress={() => void onCopy()}
          />

          {remindersAvailable ? (
            <ProviderRow
              title="Apple Reminders"
              description="Add items to a Reminders list you choose"
              icon={ListTodo}
              disabled={listsLoading || exportCount === 0}
              onPress={() => void openReminders()}
            />
          ) : null}

          {copying ? (
            <View className="mt-2 flex-row items-center justify-center gap-2 py-2">
              <Spinner />
              <Text className="text-xs text-muted-foreground">Copying…</Text>
            </View>
          ) : null}
        </View>
      ) : (
        <View className="gap-3 pb-1">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to export options"
            onPress={() => {
              tapHaptic();
              setStep("providers");
            }}
            className="flex-row items-center gap-1 self-start active:opacity-70"
            disabled={exporting}
          >
            <ChevronLeft size={18} color={colors.mutedForeground} />
            <Text className="text-sm text-muted-foreground">Export</Text>
          </Pressable>

          <View>
            <Text className="font-sans-bold text-lg">Apple Reminders</Text>
            <Text className="mt-1 text-sm text-muted-foreground">
              Choose a list, then add the active grocery items.
            </Text>
          </View>

          {listsLoading ? (
            <View className="items-center gap-2 py-8">
              <ActivityIndicator color={colors.mutedForeground} />
              <Text className="text-xs text-muted-foreground">Loading lists…</Text>
            </View>
          ) : listsError ? (
            <View className="rounded-xl border border-border bg-secondary/40 px-3 py-4">
              <Text className="text-center text-sm text-muted-foreground">{listsError}</Text>
              <Button size="sm" className="mt-3 self-center" onPress={() => void openReminders()}>
                Try again
              </Button>
            </View>
          ) : (
            <>
              <ScrollView
                style={{ maxHeight: 280 }}
                contentContainerStyle={{ gap: 4 }}
                keyboardShouldPersistTaps="handled"
              >
                {lists.map((list) => {
                  const selected = list.id === selectedListId;
                  return (
                    <Pressable
                      key={list.id}
                      accessibilityRole="radio"
                      accessibilityState={{ selected }}
                      onPress={() => {
                        tapHaptic();
                        setSelectedListId(list.id);
                      }}
                      className={
                        selected
                          ? "flex-row items-center gap-3 rounded-lg border border-[rgba(34,197,94,0.45)] bg-[#22c55e]/10 px-3 py-3"
                          : "flex-row items-center gap-3 rounded-lg border border-transparent px-3 py-3 active:bg-secondary/60"
                      }
                    >
                      <View className="min-w-0 flex-1">
                        <Text className="font-sans-medium text-sm">{list.title}</Text>
                        {list.sourceName ? (
                          <Text className="mt-0.5 text-xs text-muted-foreground">
                            {list.sourceName}
                          </Text>
                        ) : null}
                      </View>
                      {selected ? <Check size={18} color={colors.green500} /> : null}
                    </Pressable>
                  );
                })}
              </ScrollView>

              <Button
                className="mt-1"
                disabled={!selectedListId || exporting}
                onPress={() => void onPushToReminders()}
              >
                {exporting
                  ? "Adding…"
                  : `Add ${exportCount} ${exportCount === 1 ? "item" : "items"}`}
              </Button>
            </>
          )}
        </View>
      )}
    </Sheet>
  );
}
