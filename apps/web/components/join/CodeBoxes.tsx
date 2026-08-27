"use client";

import React, { useEffect, useRef } from "react";

const LEN = 6;
const ALLOWED = /[^A-Z0-9]/g;

/**
 * OTP-style room-code input: six boxes with auto-advance, backspace
 * navigation, arrow keys and paste-distribution. `invalid` briefly shakes
 * the group (parent owns resetting the flag).
 */
export function CodeBoxes({
  value,
  onChange,
  onComplete,
  invalid,
}: {
  value: string;
  onChange: (v: string) => void;
  /** fired when the sixth character lands */
  onComplete?: (code: string) => void;
  invalid: boolean;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const chars = Array.from({ length: LEN }, (_, i) => value[i] ?? "");
  const completedRef = useRef(false);

  useEffect(() => {
    if (value.length === LEN && !completedRef.current) {
      completedRef.current = true;
      onComplete?.(value);
    }
    if (value.length < LEN) completedRef.current = false;
  }, [value, onComplete]);

  const setChar = (index: number, raw: string) => {
    const clean = raw.toUpperCase().replace(ALLOWED, "").slice(-1);
    const next = chars.map((c, i) => (i === index ? clean : c)).join("");
    onChange(next);
    if (clean && index < LEN - 1) refs.current[index + 1]?.focus();
  };

  const distributePaste = (text: string) => {
    const clean = text.toUpperCase().replace(ALLOWED, "").slice(0, LEN);
    if (!clean) return;
    onChange(clean);
    refs.current[Math.min(clean.length, LEN - 1)]?.focus();
  };

  return (
    <div
      className={`flex justify-between gap-1 sm:gap-1.5 w-full ${invalid ? "animate-shakeX" : ""}`}
      onPaste={(e) => {
        e.preventDefault();
        distributePaste(e.clipboardData.getData("text"));
      }}
    >
      {chars.map((ch, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={ch}
          inputMode="text"
          autoCapitalize="characters"
          maxLength={2} // allow overtype feel; we keep only the last char
          aria-label={`Room code character ${i + 1}`}
          onChange={(e) => setChar(i, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Backspace") {
              e.preventDefault();
              if (ch) {
                onChange(
                  chars
                    .map((c, j) => (j === i ? "" : c))
                    .join("")
                );
              } else if (i > 0) {
                onChange(
                  chars
                    .map((c, j) => (j === i - 1 ? "" : c))
                    .join("")
                );
                refs.current[i - 1]?.focus();
              }
            } else if (e.key === "ArrowLeft" && i > 0) {
              refs.current[i - 1]?.focus();
            } else if (e.key === "ArrowRight" && i < LEN - 1) {
              refs.current[i + 1]?.focus();
            }
          }}
          onFocus={(e) => e.currentTarget.select()}
          className={`h-11 sm:h-12 w-full min-w-0 rounded-xl bg-black/35 text-center text-base sm:text-lg font-black tabnum ring-1 transition-colors focus:outline-none focus:ring-gold/60 ${
            invalid ? "text-crimson ring-crimson/60" : "ring-white/12"
          }`}
        />
      ))}
    </div>
  );
}
