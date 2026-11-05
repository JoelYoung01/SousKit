/**
 * Sous Kit design tokens — mirrors DESIGN.md and the web app's
 * src/assets/index.css (zinc dark + green accent, dark only).
 *
 * Fonts: iOS needs an exact font-family name per weight, so weights are
 * exposed as dedicated font utilities (font-sans, font-sans-medium,
 * font-sans-semibold, font-sans-bold) instead of font-weight classes.
 */

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,jsx,ts,tsx}"],
  presets: [require("nativewind/preset")],
  theme: {
    extend: {
      colors: {
        background: "#090b09",
        foreground: "#f4f7f5",
        card: {
          DEFAULT: "#181b18",
          foreground: "#f4f7f5",
        },
        popover: {
          DEFAULT: "#181b18",
          foreground: "#f4f7f5",
        },
        primary: {
          DEFAULT: "#16a34a",
          foreground: "#f4f7f5",
        },
        secondary: {
          DEFAULT: "#1f231f",
          foreground: "#f4f7f5",
        },
        muted: {
          DEFAULT: "#1f231f",
          foreground: "#9aa39c",
        },
        accent: {
          DEFAULT: "#1f231f",
          foreground: "#f4f7f5",
        },
        destructive: "#ef4444",
        border: "#323834",
        input: "#323834",
        ring: "#22c55e",
        elevated: "#151816",
        faint: "#6b746e",
        "success-soft": "#86efac",
        "gap-dot": "#3f463f",
      },
      borderRadius: {
        sm: "10px",
        md: "12px",
        lg: "14px",
        xl: "18px",
      },
      fontFamily: {
        sans: ["Figtree_400Regular"],
        "sans-italic": ["Figtree_400Regular_Italic"],
        "sans-medium": ["Figtree_500Medium"],
        "sans-semibold": ["Figtree_600SemiBold"],
        "sans-semibold-italic": ["Figtree_600SemiBold_Italic"],
        "sans-bold": ["Figtree_700Bold"],
      },
    },
  },
  plugins: [],
};
