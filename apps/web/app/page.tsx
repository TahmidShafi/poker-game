"use client";

import React, { useEffect, useState } from "react";
import { useGame } from "../lib/store";
import { JoinScreen } from "../components/JoinScreen";
import { TableOval } from "../components/TableOval";
import { MobileTable } from "../components/MobileTable";
import { ActionBar } from "../components/ActionBar";
import { MobileActionBar } from "../components/MobileActionBar";
import { HandRankingsModal } from "../components/HandRankingsModal";
import { WinnerBanner } from "../components/WinnerBanner";
import { LoanRequestModal, RepayDialog } from "../components/LoanModals";
import { HeaderBar } from "../components/HeaderBar";
import { LeftSidebar } from "../components/LeftSidebar";
import { RightSidebar } from "../components/RightSidebar";
import { InfoSheet } from "../components/InfoSheet";

export default function HomePage() {
  const {
    status,
    me,
    state,
    showdown,
    clearShowdown,
    toast,
    incomingLoan,
    leaveRoom,
    serverUrl,
  } = useGame();

  const [showHelp, setShowHelp] = useState(false);
  const [showRepay, setShowRepay] = useState(false);
  const [drawerLeft, setDrawerLeft] = useState(false);
  const [drawerRight, setDrawerRight] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);

  // Deep-link ?room=CODE cleanup once seated.
  useEffect(() => {
    if (!me) return;
    const url = new URL(window.location.href);
    if (url.searchParams.get("room")) {
      url.searchParams.delete("room");
      window.history.replaceState({}, "", url.pathname);
    }
  }, [me]);

  if (!me) return <JoinScreen />;

  const mySeat = me.seatIndex;

  /**
   * Seated view = fixed gameplay viewport on mobile:
   * header / stage / action dock all fit one 100dvh screen, zero page scroll.
   * Desktop (md+) keeps the original flowing document layout.
   */
  const Drawer = ({
    open,
    onClose,
    side,
    children,
  }: {
    open: boolean;
    onClose: () => void;
    side: "left" | "right";
    children: React.ReactNode;
  }) =>
    open ? (
      <div className="fixed inset-0 z-40 flex" onClick={onClose}>
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
        <div
          className={`relative h-full w-[290px] overflow-y-auto bg-room p-3 shadow-panel ${
            side === "left" ? "mr-auto ml-0" : "ml-auto"
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      </div>
    ) : null;

  return (
    <div className="flex h-dvh min-h-dvh flex-col overflow-hidden dt:h-auto dt:min-h-screen dt:overflow-visible">
      {/* ================= Header ================= */}
      <div className="safe-t mx-auto w-full max-w-[1500px] shrink-0 px-2 pt-2 dt:px-3 dt:pt-3">
        <HeaderBar
          state={state}
          onOpenRankings={() => setShowHelp(true)}
          onToggleLeft={() => setDrawerLeft((v) => !v)}
          onToggleRight={() => setDrawerRight((v) => !v)}
          onOpenSheet={() => setSheetOpen(true)}
        />
      </div>

      {status === "offline" && (
        <div className="mx-auto w-full max-w-[1500px] shrink-0 px-2 pt-1 dt:mt-2 dt:px-3">
          <div className="rounded-lg bg-amber-500/15 px-3 py-1 text-center text-[11px] text-amber-200 ring-1 ring-amber-400/30 dt:text-xs">
            Connection lost — reconnecting to {serverUrl}…
          </div>
        </div>
      )}

      {/* ================= Body grid ================= */}
      <div className="mx-auto grid min-h-0 w-full max-w-[1500px] flex-1 gap-2 px-2 pb-1 pt-1.5 dt:gap-3 dt:px-3 dt:pb-0 dt:pt-3 xl:grid-cols-[250px_minmax(0,1fr)_275px]">
        {/* Left sidebar (xl only) */}
        <aside className="hidden min-h-0 overflow-y-auto xl:block">
          <LeftSidebar onOpenRepay={() => setShowRepay(true)} />
        </aside>

        {/* Center: stage + action dock */}
        <main className="flex min-h-0 min-w-0 flex-col">
          {state ? (
            <>
              {/* Stage: dedicated mobile composition / desktop oval */}
              <div className="relative min-h-0 flex-1">
                <div className="absolute inset-0 dt:hidden">
                  <MobileTable state={state} mySeat={mySeat} />
                </div>
                <div className="hidden dt:block">
                  <TableOval state={state} mySeat={mySeat} />
                </div>
              </div>

              {/* Action dock — always visible, reserves its own space */}
              <div className="safe-b mx-auto w-full max-w-md shrink-0 pt-1.5 dt:max-w-none dt:pb-4 dt:pt-3">
                <div className="dt:hidden">
                  <MobileActionBar
                    state={state}
                    mySeat={mySeat}
                    turnDeadline={state.turnDeadline}
                  />
                </div>
                <div className="hidden dt:block">
                  <ActionBar state={state} mySeat={mySeat} turnDeadline={state.turnDeadline} />
                </div>
              </div>

              {showdown && showdown.length > 0 && (
                <WinnerBanner results={showdown} onClose={clearShowdown} />
              )}
              {incomingLoan && <LoanRequestModal request={incomingLoan} state={state} />}
              {showRepay && (
                <RepayDialog state={state} mySeat={mySeat} onClose={() => setShowRepay(false)} />
              )}
            </>
          ) : (
            <div className="grid flex-1 place-items-center py-24 text-sm text-white/40">
              joining table…
            </div>
          )}
        </main>

        {/* Right sidebar (xl only) */}
        <aside className="hidden min-h-0 overflow-y-auto xl:block">
          {state && <RightSidebar state={state} />}
        </aside>
      </div>

      {/* ================= Drawers (md..xl) ================= */}
      <Drawer side="left" open={drawerLeft} onClose={() => setDrawerLeft(false)}>
        <LeftSidebar onOpenRepay={() => { setShowRepay(true); setDrawerLeft(false); }} />
      </Drawer>
      <Drawer side="right" open={drawerRight} onClose={() => setDrawerRight(false)}>
        {state && <RightSidebar state={state} />}
      </Drawer>

      {/* ================= Mobile info sheet (<md) ================= */}
      {state && (
        <InfoSheet
          open={sheetOpen}
          state={state}
          onClose={() => setSheetOpen(false)}
          onOpenRankings={() => setShowHelp(true)}
          onOpenRepay={() => setShowRepay(true)}
        />
      )}

      {/* ================= Global modals ================= */}
      {showHelp && <HandRankingsModal onClose={() => setShowHelp(false)} />}

      {toast && (
        <div className="fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+7rem)] z-[60] flex justify-center px-4 dt:bottom-4">
          <div
            className={`glass rounded-xl px-4 py-2.5 text-sm font-semibold animate-riseFade ${
              toast.kind === "error"
                ? "text-red-200 ring-1 ring-crimson/40"
                : "text-emerald-200 ring-1 ring-emerald-400/40"
            }`}
          >
            {toast.message}
          </div>
        </div>
      )}

      {/* Leave is inside the gear menu now; keep an accessible fallback */}
      <button onClick={leaveRoom} className="sr-only">
        Leave room
      </button>
    </div>
  );
}
