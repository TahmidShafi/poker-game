"use client";

import React, { useEffect, useState } from "react";
import { useGame } from "../lib/store";
import { JoinScreen } from "../components/JoinScreen";
import { TableOval } from "../components/TableOval";
import { ActionBar } from "../components/ActionBar";
import { HandRankingsModal } from "../components/HandRankingsModal";
import { WinnerBanner } from "../components/WinnerBanner";
import { LoanRequestModal, RepayDialog } from "../components/LoanModals";
import { HeaderBar } from "../components/HeaderBar";
import { LeftSidebar } from "../components/LeftSidebar";
import { RightSidebar } from "../components/RightSidebar";
import { PlayingCard } from "../components/PlayingCard";

export default function HomePage() {
  const {
    status,
    me,
    state,
    myCards,
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
  const myDebt = state?.seats[mySeat]?.debtTo ?? {};
  const owes = Object.values(myDebt).some((v) => v > 0);
  const statusColor =
    status === "online" ? "bg-emerald-400" : status === "connecting" ? "bg-amber-400" : "bg-crimson";

  const Drawer = ({
    side,
    open,
    onClose,
    children,
  }: {
    side: "left" | "right";
    open: boolean;
    onClose: () => void;
    children: React.ReactNode;
  }) =>
    open ? (
      <div className="fixed inset-0 z-40 flex" onClick={onClose}>
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
        <div
          className={`relative ml-auto h-full w-[290px] overflow-y-auto bg-room p-3 shadow-panel ${
            side === "left" ? "ml-0 mr-auto" : ""
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          {children}
        </div>
      </div>
    ) : null;

  return (
    <div className="min-h-screen">
      {/* ================= Header ================= */}
      <div className="mx-auto w-full max-w-[1500px] px-3 pt-3">
        <HeaderBar
          state={state}
          onOpenRankings={() => setShowHelp(true)}
          onToggleLeft={() => setDrawerLeft((v) => !v)}
          onToggleRight={() => setDrawerRight((v) => !v)}
        />
      </div>

      {status === "offline" && (
        <div className="mx-auto mt-2 w-full max-w-[1500px] px-3">
          <div className="rounded-xl bg-amber-500/15 px-3 py-2 text-center text-xs text-amber-200 ring-1 ring-amber-400/30">
            Connection lost — reconnecting to {serverUrl}…
          </div>
        </div>
      )}

      {/* ================= Body grid ================= */}
      <div className="mx-auto grid w-full max-w-[1500px] gap-3 px-3 pb-5 pt-3 xl:grid-cols-[250px_minmax(0,1fr)_275px]">
        {/* Left sidebar */}
        <aside className="hidden xl:block">
          <LeftSidebar onOpenRepay={() => setShowRepay(true)} />
        </aside>

        {/* Center */}
        <main className="flex min-w-0 flex-col gap-4">
          {state ? (
            <>
              <TableOval state={state} mySeat={mySeat} />

              {/* My hole cards — mobile & tablet only (desktop shows them on the table) */}
              <div className="flex justify-center gap-1.5 lg:hidden">
                {(() => {
                  const seat = state.seats[mySeat];
                  if (seat?.holeCards && seat.holeCards.length === 2)
                    return seat.holeCards.map((c, i) => (
                      <PlayingCard key={i} card={c} size="md" animate="deal" delay={i * 110} />
                    ));
                  if (myCards) return myCards.map((c, i) => <PlayingCard key={i} card={c} size="md" />);
                  return (
                    <>
                      <PlayingCard faceDown size="md" />
                      <PlayingCard faceDown size="md" />
                    </>
                  );
                })()}
              </div>

              <ActionBar state={state} mySeat={mySeat} turnDeadline={state.turnDeadline} />

              {showdown && showdown.length > 0 && (
                <WinnerBanner results={showdown} onClose={clearShowdown} />
              )}
              {incomingLoan && state && <LoanRequestModal request={incomingLoan} state={state} />}
              {showRepay && state && (
                <RepayDialog state={state} mySeat={mySeat} onClose={() => setShowRepay(false)} />
              )}
            </>
          ) : (
            <div className="grid flex-1 place-items-center py-24 text-sm text-white/40">
              joining table…
            </div>
          )}
        </main>

        {/* Right sidebar */}
        <aside className="hidden xl:block">
          {state && <RightSidebar state={state} />}
        </aside>
      </div>

      {/* ================= Drawers (<xl) ================= */}
      <Drawer side="left" open={drawerLeft} onClose={() => setDrawerLeft(false)}>
        <LeftSidebar onOpenRepay={() => { setShowRepay(true); setDrawerLeft(false); }} />
      </Drawer>
      <Drawer side="right" open={drawerRight} onClose={() => setDrawerRight(false)}>
        {state && <RightSidebar state={state} />}
      </Drawer>

      {/* ================= Global modals ================= */}
      {showHelp && <HandRankingsModal onClose={() => setShowHelp(false)} />}

      {toast && (
        <div className="fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4">
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
