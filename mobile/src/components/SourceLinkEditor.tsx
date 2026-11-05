import { resolveSourceLink } from "@/api/recipes";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import { colors } from "@/lib/colors";
import {
  applySourceLinkInput,
  hostnameLabel,
  isPlaceholderName,
  lookupSiteName,
  mergeSourceLinks,
  parseSourceLinkInput,
  type SourceLinkDraft
} from "@/lib/sourceLinks";
import { toast } from "@/stores/toast";
import type { RecipeSourceLink } from "@/types";
import { X } from "lucide-react-native";
import { useEffect, useRef, useState } from "react";
import { Pressable, TextInput, View } from "react-native";

function sameLinks(saved: RecipeSourceLink[], current: SourceLinkDraft[]) {
  if (saved.length !== current.length) return false;
  return saved.every(
    (link, index) => link.url === current[index]?.url && link.name === current[index]?.name
  );
}

function toPayload(rows: SourceLinkDraft[]): RecipeSourceLink[] {
  return rows.map(({ name, url }) => ({ name, url }));
}

export function SourceLinkEditor({
  links,
  onChange
}: {
  links: RecipeSourceLink[];
  onChange: (links: RecipeSourceLink[]) => void;
}) {
  const [drafts, setDrafts] = useState<SourceLinkDraft[]>([]);
  const [draftText, setDraftText] = useState("");
  const [pendingName, setPendingName] = useState("");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");
  const draftsRef = useRef(drafts);
  const draftTextRef = useRef("");
  const lookups = useRef(new Map<string, number>());
  const lookupSeq = useRef(0);

  const setText = (value: string) => {
    draftTextRef.current = value;
    setDraftText(value);
  };

  function publish(rows: SourceLinkDraft[]) {
    draftsRef.current = rows;
    setDrafts(rows);
    onChange(toPayload(rows));
  }

  async function refreshName(url: string) {
    const token = ++lookupSeq.current;
    lookups.current.set(url, token);
    const resolved = await lookupSiteName(url, resolveSourceLink);
    if (lookups.current.get(url) !== token) return;
    const current = draftsRef.current;
    const index = current.findIndex((link) => link.url === url && link.autoName);
    if (index < 0) return;
    const next = current.slice();
    next[index] = {
      name: resolved.name,
      url: resolved.url || url,
      autoName: true
    };
    publish(next);
  }

  useEffect(() => {
    if (sameLinks(links, draftsRef.current)) return;
    const next = links.map((link) => ({
      name: link.name,
      url: link.url,
      autoName: isPlaceholderName(link.name, link.url)
    }));
    draftsRef.current = next;
    setDrafts(next);
    for (const link of next) {
      if (link.autoName) void refreshName(link.url);
    }
    // refreshName is stable enough for link identity changes; lookups are keyed by URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [links]);

  const commitDraft = (raw?: string) => {
    const value = raw ?? draftTextRef.current;
    if (!value.trim()) return;
    draftTextRef.current = "";
    setDraftText("");
    const applied = applySourceLinkInput(value, pendingName);
    setPendingName(applied.pendingName);
    if (!applied.additions.length) return;
    const before = draftsRef.current.length;
    const merged = mergeSourceLinks(draftsRef.current, applied.additions);
    publish(merged.links);
    if (merged.rejected === "limit") {
      toast.error("You can save up to 12 source links.");
    } else if (merged.rejected === "duplicate" && merged.links.length === before) {
      toast.error("That link is already on this recipe.");
    }
    for (const addition of applied.additions) {
      if (addition.autoName && merged.links.some((link) => link.url === addition.url)) {
        void refreshName(addition.url);
      }
    }
  };

  const commitRename = () => {
    const index = editingIndex;
    if (index == null) return;
    setEditingIndex(null);
    const raw = editingText.trim();
    const current = draftsRef.current[index];
    if (!raw || !current) return;
    const parsed = parseSourceLinkInput(raw);
    const only = parsed.length === 1 ? parsed[0] : undefined;
    const next = draftsRef.current.slice();
    if (only?.url) {
      next[index] = {
        name: only.name || hostnameLabel(only.url),
        url: only.url,
        autoName: !only.name
      };
      publish(next);
      if (!only.name) void refreshName(only.url);
      return;
    }
    next[index] = { ...current, name: raw, autoName: false };
    publish(next);
  };

  return (
    <View className="gap-2">
      <Label>Sources</Label>
      {drafts.length ? (
        <View className="flex-row flex-wrap gap-2">
          {drafts.map((link, index) => (
            <View
              key={`${link.url}-${index}`}
              className="max-w-full flex-row items-center gap-1 rounded-full bg-secondary py-1 pl-3 pr-1"
            >
              {editingIndex === index ? (
                <TextInput
                  value={editingText}
                  onChangeText={setEditingText}
                  onSubmitEditing={commitRename}
                  onBlur={commitRename}
                  autoFocus
                  placeholderTextColor={colors.faint}
                  selectionColor={colors.ring}
                  accessibilityLabel={`Name for ${link.url}`}
                  className="min-w-24 font-sans text-[14px] text-foreground"
                />
              ) : (
                <Pressable onPress={() => {
                  setEditingIndex(index);
                  setEditingText(link.name);
                }}>
                  <Text className="max-w-52 text-sm font-sans-semibold text-[#4ade80]" numberOfLines={1}>
                    {link.name}
                  </Text>
                </Pressable>
              )}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Remove ${link.name}`}
                onPress={() => publish(draftsRef.current.filter((_, itemIndex) => itemIndex !== index))}
                className="rounded-full p-1"
              >
                <X size={14} color={colors.mutedForeground} />
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
      <Input
        value={draftText}
        onChangeText={(value) => {
          if (/[,\n]/.test(value) && /https?:\/\//i.test(value)) {
            commitDraft(value);
            return;
          }
          setText(value);
        }}
        onSubmitEditing={() => commitDraft()}
        onBlur={() => commitDraft()}
        placeholder="Paste a URL or site name"
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType="url"
        className="h-11 rounded-xl"
      />
      {pendingName ? (
        <Text className="text-xs leading-4 text-muted-foreground">
          Next link will be labeled “{pendingName}”.{" "}
          <Text className="text-xs text-[#4ade80]" onPress={() => setPendingName("")}>
            Clear
          </Text>
        </Text>
      ) : null}
      <Text className="text-xs leading-4 text-muted-foreground">
        Paste a link, a comma-separated list, or a site name. The chip uses the website name, and
        the URL is saved separately. Tap a chip to rename it.
      </Text>
    </View>
  );
}
