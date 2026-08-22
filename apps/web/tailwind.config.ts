import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        room: "#0b0f14",
        panel: "rgba(255,255,255,0.05)",
        felt: "#1B5E43",
        feltDeep: "#0E3A29",
        rail: "#3B2A1A",
        gold: "#D8B36A",
        goldDim: "#8a6f42",
        crimson: "#C0392B",
        ink: "#1A1A1A",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
      boxShadow: {
        card: "0 6px 16px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.35) inset",
        glowGold: "0 0 18px rgba(216,179,106,0.35)",
      },
      keyframes: {
        dealIn: {
          "0%": { transform: "translate(var(--deal-from-x, -140px), var(--deal-from-y, -120px)) rotate(-14deg) scale(0.7)", opacity: "0" },
          "100%": { transform: "translate(0,0) rotate(0deg) scale(1)", opacity: "1" },
        },
        flipY: {
          "0%": { transform: "rotateY(90deg)" },
          "100%": { transform: "rotateY(0deg)" },
        },
        popChip: {
          "0%": { transform: "translateY(10px) scale(0.6)", opacity: "0" },
          "60%": { transform: "translateY(-3px) scale(1.05)", opacity: "1" },
          "100%": { transform: "translateY(0) scale(1)", opacity: "1" },
        },
        pulseRed: {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(192,57,43,0.55)" },
          "50%": { boxShadow: "0 0 0 10px rgba(192,57,43,0)" },
        },
        riseFade: {
          "0%": { transform: "translateY(14px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },
      animation: {
        dealIn: "dealIn .38s cubic-bezier(.22,.9,.34,1.05) both",
        flipY: "flipY .28s ease-out both",
        popChip: "popChip .3s cubic-bezier(.2,.8,.3,1.2) both",
        pulseRed: "pulseRed 1s ease-out infinite",
        riseFade: "riseFade .25s ease-out both",
      },
    },
  },
  plugins: [],
};

export default config;
