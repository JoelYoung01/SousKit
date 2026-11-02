import { cn } from "@/lib/cn";
import { colors } from "@/lib/colors";
import { forwardRef } from "react";
import { TextInput, type TextInputProps } from "react-native";

/**
 * Tailwind `text-*` sizes also set lineHeight. A lineHeight on a single-line
 * TextInput makes iOS wrap unfocused text, so a long value draws a second line
 * and the field border cuts through it. Keep the font size, drop the leading.
 */
const FONT_SIZE_WITHOUT_LEADING: Record<string, string> = {
  "text-xs": "text-[12px]",
  "text-sm": "text-[14px]",
  "text-base": "text-[16px]",
  "text-lg": "text-[18px]",
  "text-xl": "text-[20px]",
  "text-2xl": "text-[24px]"
};

function withoutInputLineHeight(className?: string) {
  if (!className) return className;
  return className
    .split(/\s+/)
    .filter((token) => token && !/^!?leading-/.test(token))
    .map((token) => FONT_SIZE_WITHOUT_LEADING[token] ?? token)
    .join(" ");
}

export const Input = forwardRef<TextInput, TextInputProps>(function Input(
  { className, ...props },
  ref
) {
  return (
    <TextInput
      ref={ref}
      placeholderTextColor={colors.faint}
      keyboardAppearance="dark"
      selectionColor={colors.ring}
      className={cn(
        "h-12 w-full rounded-lg border border-input bg-card px-3 font-sans text-[16px] text-foreground",
        withoutInputLineHeight(className)
      )}
      {...props}
    />
  );
});
