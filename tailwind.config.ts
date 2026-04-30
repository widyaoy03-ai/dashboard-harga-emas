import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: "#0B2A78",
        primaryDark: "#1F2F63",
        accentRed: "#E3262E",
        background: "#F5F7FB",
        surface: "#FFFFFF",
        textPrimary: "#1F2937",
        textSecondary: "#6B7280",
        border: "#D1D5DB"
      },
      fontFamily: {
        sans: ["var(--font-ui)", "Plus Jakarta Sans", "Inter", "sans-serif"],
        serifPreview: ["var(--font-preview)", "Source Serif 4", "serif"]
      },
      boxShadow: {
        panel: "0 1px 2px rgba(31, 41, 55, 0.06)"
      }
    }
  },
  plugins: []
};

export default config;
