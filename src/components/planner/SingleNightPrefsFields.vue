<script setup lang="ts">
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { MealPlanWizardPrefs } from "@/types";

const prefs = defineModel<MealPlanWizardPrefs>({ required: true });

const VIBE_CHIPS = [
  "Quick & easy",
  "Comfort food",
  "Light & fresh",
  "High protein",
  "One-pan",
  "Date night"
];

const DIET_CHIPS = ["Vegetarian", "Gluten-free", "Dairy-free", "Nut-free", "Low carb", "No pork"];

function toggleInField(field: "goals" | "dietary_restrictions", chip: string) {
  const current = prefs.value[field] || "";
  const parts = current
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const exists = parts.some((p) => p.toLowerCase() === chip.toLowerCase());
  const next = exists
    ? parts.filter((p) => p.toLowerCase() !== chip.toLowerCase())
    : [...parts, chip];
  prefs.value = { ...prefs.value, [field]: next.join(", ") };
}

function chipActive(field: "goals" | "dietary_restrictions", chip: string) {
  return (prefs.value[field] || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .includes(chip.toLowerCase());
}
</script>

<template>
  <div class="space-y-5">
    <div>
      <Label class="text-sm font-semibold">What’s the vibe?</Label>
      <p class="mt-0.5 text-xs text-muted-foreground">Optional — style or mood for this dinner</p>
      <div class="mt-2 flex flex-wrap gap-1.5">
        <button
          v-for="chip in VIBE_CHIPS"
          :key="chip"
          type="button"
          class="rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors"
          :class="
            chipActive('goals', chip)
              ? 'border-[rgba(34,197,94,0.45)] bg-[rgba(34,197,94,0.14)] text-[#86efac]'
              : 'border-border bg-secondary/50 text-muted-foreground'
          "
          @click="toggleInField('goals', chip)"
        >
          {{ chip }}
        </button>
      </div>
      <Input
        class="mt-2"
        placeholder="e.g. cozy bowl, crispy skillet dinner, something summery…"
        :model-value="prefs.goals"
        @update:model-value="prefs = { ...prefs, goals: String($event) }"
      />
    </div>

    <div>
      <Label class="text-sm font-semibold">Ingredients to use</Label>
      <p class="mt-0.5 text-xs text-muted-foreground">
        Optional — what’s in your fridge or pantry right now?
      </p>
      <Textarea
        class="mt-2 min-h-16"
        placeholder="e.g. salmon fillets, asparagus, lemon, garlic…"
        :model-value="prefs.preferred_ingredients"
        @update:model-value="prefs = { ...prefs, preferred_ingredients: String($event) }"
      />
    </div>

    <div>
      <Label class="text-sm font-semibold">Dietary needs</Label>
      <p class="mt-0.5 text-xs text-muted-foreground">
        Optional — allergies or restrictions for this meal
      </p>
      <div class="mt-2 flex flex-wrap gap-1.5">
        <button
          v-for="chip in DIET_CHIPS"
          :key="chip"
          type="button"
          class="rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition-colors"
          :class="
            chipActive('dietary_restrictions', chip)
              ? 'border-[rgba(34,197,94,0.45)] bg-[rgba(34,197,94,0.14)] text-[#86efac]'
              : 'border-border bg-secondary/50 text-muted-foreground'
          "
          @click="toggleInField('dietary_restrictions', chip)"
        >
          {{ chip }}
        </button>
      </div>
      <Input
        class="mt-2"
        placeholder="e.g. dairy-free, no shellfish…"
        :model-value="prefs.dietary_restrictions"
        @update:model-value="prefs = { ...prefs, dietary_restrictions: String($event) }"
      />
    </div>

    <div class="grid grid-cols-2 gap-3">
      <div>
        <Label class="text-sm font-semibold">Max cook time</Label>
        <Input
          class="mt-2"
          type="number"
          min="10"
          max="240"
          placeholder="minutes"
          :model-value="prefs.max_cook_minutes ?? ''"
          @update:model-value="
            prefs = {
              ...prefs,
              max_cook_minutes: $event === '' ? null : Number($event)
            }
          "
        />
      </div>
      <div>
        <Label class="text-sm font-semibold">Servings</Label>
        <Input
          class="mt-2"
          type="number"
          min="1"
          max="20"
          placeholder="people"
          :model-value="prefs.servings ?? ''"
          @update:model-value="
            prefs = {
              ...prefs,
              servings: $event === '' ? null : Number($event)
            }
          "
        />
      </div>
    </div>

    <div>
      <Label class="text-sm font-semibold">Cuisine or flavor</Label>
      <Input
        class="mt-2"
        placeholder="e.g. Thai, Mexican, garlicky herb, spicy…"
        :model-value="prefs.cuisine_notes"
        @update:model-value="prefs = { ...prefs, cuisine_notes: String($event) }"
      />
    </div>

    <div>
      <Label class="text-sm font-semibold">Specific requests</Label>
      <Textarea
        class="mt-2 min-h-16"
        placeholder="e.g. extra saucy, kid-friendly, no cilantro…"
        :model-value="prefs.extra_notes"
        @update:model-value="prefs = { ...prefs, extra_notes: String($event) }"
      />
    </div>
  </div>
</template>
