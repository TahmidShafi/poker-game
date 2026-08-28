import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    screens: {
      sm: "640px",
      // "Desktop" layout needs width AND usable height, so landscape phones
      // (e.g. 844×390) stay on the dedicated mobile table.
      dt: { raw: "(min-width: 768px) and (min-height: 520px)" },
      lg: "1024px",
      xl: "1280px",
      "2xl": "1536px",
    },
    extend: {
      colors: {
        room: "#0B0F14",
        panel: "#121A26",
        panel2: "#0E1520",
        line: "rgba(255,255,255,0.07)",
        felt: "#1E6B47",
        feltDeep: "#0F4029",
        rail: "#241A12",
        railLight: "#4A3623",
        gold: "#F0C75E",
        goldDim: "#D8B36A",
        crimson: "#EF4444",
        ink: "#16181D",
        accent: "#8B5CF6",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
      },
      boxShadow: {
        card: "0 6px 16px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.35) inset",
        glowGold: "0 0 18px rgba(240,199,94,0.35)",
        glowGreen: "0 0 0 2px rgba(52,211,153,0.8), 0 0 24px rgba(52,211,153,0.45)",
        panel: "0 10px 30px rgba(0,0,0,0.35)",
      },
      keyframes: {
        dealIn: {
          "0%": { transform: "translate(var(--deal-from-x, -140px), var(--deal-from-y, -120px)) rotate(-14deg) scale(0.7)", opacity: "0" },
          "100%": { transform: "translate(0,0) rotate(0deg) scale(1)", opacity: "1" },
        },
        sweepOut: {
          "0%": { transform: "translate(0,0) rotate(0deg) scale(1)", opacity: "1" },
          "100%": { transform: "translate(var(--sweep-to-x, 0), var(--sweep-to-y, 100px)) rotate(14deg) scale(0.3)", opacity: "0" },
        },
        flipY: { "0%": { transform: "rotateY(90deg)" }, "100%": { transform: "rotateY(0deg)" } },
        popChip: {
          "0%": { transform: "translateY(10px) scale(0.6)", opacity: "0" },
          "60%": { transform: "translateY(-3px) scale(1.05)", opacity: "1" },
          "100%": { transform: "translateY(0) scale(1)", opacity: "1" },
        },
        pulseRed: {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(239,68,68,0.55)" },
          "50%": { boxShadow: "0 0 0 10px rgba(239,68,68,0)" },
        },
        riseFade: {
          "0%": { transform: "translateY(14px)", opacity: "0" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
        floatY: {
          "0%, 100%": { transform: "translateY(0) rotate(var(--fl-rot, 0deg))" },
          "50%": { transform: "translateY(-16px) rotate(var(--fl-rot, 0deg))" },
        },
        shakeX: {
          "0%, 100%": { transform: "translateX(0)" },
          "20%": { transform: "translateX(-7px)" },
          "40%": { transform: "translateX(7px)" },
          "60%": { transform: "translateX(-4px)" },
          "80%": { transform: "translateX(4px)" },
        },
        scorePop: {
          "0%": { transform: "scale(1) rotate(0deg)" },
          "40%": { transform: "scale(1.18) rotate(-3deg)" },
          "70%": { transform: "scale(0.96) rotate(2deg)" },
          "100%": { transform: "scale(1) rotate(0deg)" },
        },
      },
      animation: {
        dealIn: "dealIn .38s cubic-bezier(.22,.9,.34,1.05) both",
        sweepOut: "sweepOut 0.4s ease-in-out 1.4s both",
        flipY: "flipY .28s ease-out both",
        popChip: "popChip .3s cubic-bezier(.2,.8,.3,1.2) both",
        pulseRed: "pulseRed 1s ease-out infinite",
        riseFade: "riseFade .25s ease-out both",
        floatY: "floatY 5.5s ease-in-out infinite",
        shakeX: "shakeX .4s ease-in-out both",
        scorePop: "scorePop .5s cubic-bezier(.34,1.56,.64,1) both",
      },
    },
  },
  plugins: [],
};

export default config;
