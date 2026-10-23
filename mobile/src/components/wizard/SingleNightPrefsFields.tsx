import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import { Textarea } from "@/components/ui/textarea";
import type { MealPlanWizardPrefs } from "@/types";
import { Pressable, View } from "react-native";

const VIBE_CHIPS = [
  "Quick & easy",
  "Comfort food",
  "Light & fresh",
  "High protein",
  "One-pan",
  "Date night"
];

const DIET_CHIPS = [
  "Vegetarian",
  "Gluten-free",
  "Dairy-free",
  "Nut-free",
  "Low carb",
  "No pork"
];

function parseNumeric(value: string): number | null {
  const digits = value.replace(/[^0-9]/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

/** Single-night recipe form — tailored for generating one dinner rather than a full week. */
export function SingleNightPrefsFields({
  prefs,
  onChange
}: {
  prefs: MealPlanWizardPrefs;
  onChange: (next: MealPlanWizardPrefs) => void;
}) {
  const chipActive = (field: "goals" | "dietary_restrictions", chip: string) =>
    (prefs[field] || "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .includes(chip.toLowerCase());

  const toggleChip = (field: "goals" | "dietary_restrictions", chip: string) => {
    const parts = (prefs[field] || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const exists = parts.some((p) => p.toLowerCase() === chip.toLowerCase());
    const next = exists
      ? parts.filter((p) => p.toLowerCase() !== chip.toLowerCase())
      : [...parts, chip];
    onChange({ ...prefs, [field]: next.join(", ") });
  };

  const renderChips = (field: "goals" | "dietary_restrictions", chips: string[]) => (
    <View className="mt-2 flex-row flex-wrap gap-1.5">
      {chips.map((chip) => {
        const active = chipActive(field, chip);
        return (
          <Pressable
            key={chip}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            onPress={() => toggleChip(field, chip)}
            className={
              active
                ? "rounded-full border border-[#22c55e]/45 bg-[#22c55e]/15 px-2.5 py-1"
                : "rounded-full border border-border bg-secondary/50 px-2.5 py-1"
            }
          >
            <Text
              className={
                active
                  ? "font-sans-medium text-[11.5px] text-success-soft"
                  : "font-sans-medium text-[11.5px] text-muted-foreground"
              }
            >
              {chip}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );

  return (
    <View className="gap-5">
      <View>
        <Label className="font-sans-semibold text-sm">What’s the vibe?</Label>
        <Text className="mt-0.5 text-xs text-muted-foreground">
          Optional — style or mood for this dinner
        </Text>
        {renderChips("goals", VIBE_CHIPS)}
        <Input
          className="mt-2"
          placeholder="e.g. cozy bowl, crispy skillet dinner, something summery…"
          value={prefs.goals}
          onChangeText={(v) => onChange({ ...prefs, goals: v })}
        />
      </View>

      <View>
        <Label className="font-sans-semibold text-sm">Ingredients to use</Label>
        <Text className="mt-0.5 text-xs text-muted-foreground">
          Optional — what’s in your fridge or pantry right now?
        </Text>
        <Textarea
          className="mt-2 min-h-16"
          placeholder="e.g. salmon fillets, asparagus, lemon, garlic…"
          value={prefs.preferred_ingredients}
          onChangeText={(v) => onChange({ ...prefs, preferred_ingredients: v })}
        />
      </View>

      <View>
        <Label className="font-sans-semibold text-sm">Dietary needs</Label>
        <Text className="mt-0.5 text-xs text-muted-foreground">
          Optional — allergies or restrictions for this meal
        </Text>
        {renderChips("dietary_restrictions", DIET_CHIPS)}
        <Input
          className="mt-2"
          placeholder="e.g. dairy-free, no shellfish…"
          value={prefs.dietary_restrictions}
          onChangeText={(v) => onChange({ ...prefs, dietary_restrictions: v })}
        />
      </View>

      <View className="flex-row gap-3">
        <View className="flex-1">
          <Label className="font-sans-semibold text-sm">Max cook time</Label>
          <Input
            className="mt-2"
            keyboardType="number-pad"
            placeholder="minutes"
            value={prefs.max_cook_minutes === null ? "" : String(prefs.max_cook_minutes)}
            onChangeText={(v) => onChange({ ...prefs, max_cook_minutes: parseNumeric(v) })}
          />
        </View>
        <View className="flex-1">
          <Label className="font-sans-semibold text-sm">Servings</Label>
          <Input
            className="mt-2"
            keyboardType="number-pad"
            placeholder="people"
            value={prefs.servings === null ? "" : String(prefs.servings)}
            onChangeText={(v) => onChange({ ...prefs, servings: parseNumeric(v) })}
          />
        </View>
      </View>

      <View>
        <Label className="font-sans-semibold text-sm">Cuisine or flavor</Label>
        <Input
          className="mt-2"
          placeholder="e.g. Thai, Mexican, garlicky herb, spicy…"
          value={prefs.cuisine_notes}
          onChangeText={(v) => onChange({ ...prefs, cuisine_notes: v })}
        />
      </View>

      <View>
        <Label className="font-sans-semibold text-sm">Specific requests</Label>
        <Textarea
          className="mt-2 min-h-16"
          placeholder="e.g. extra saucy, kid-friendly, no cilantro…"
          value={prefs.extra_notes}
          onChangeText={(v) => onChange({ ...prefs, extra_notes: v })}
        />
      </View>
    </View>
  );
}
