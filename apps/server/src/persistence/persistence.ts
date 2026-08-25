import { RoomConfig, describeHand } from "@poker/shared-types";
import type { HandFinishedSummary } from "@poker/shared-types";
import { Prisma } from "@prisma/client";
import { db } from "./db";

const json = <T>(value: T): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;

/**
 * All writes are fire-and-forget: persistence problems must never take down
 * the live game. Errors are logged once per operation and swallowed.
 */
function swallow(promise: Promise<unknown>, label: string): void {
  promise.catch((err) => console.error(`[persistence] ${label} failed:`, (err as Error).message));
}

export async function ensureGameSession(
  roomCode: string,
  config: RoomConfig
): Promise<void> {
  const prisma = db();
  if (!prisma) return;
  swallow(
    prisma.gameSession.upsert({
      where: { roomCode },
      create: {
        roomCode,
        status: "WAITING_FOR_PLAYERS",
        gameType: config.gameType === "TWENTY_NINE" ? "TWENTY_NINE" : "POKER",
        startingCoins: config.startingCoins,
        smallBlind: config.smallBlind,
        bigBlind: config.bigBlind,
        turnTimeSeconds: config.turnTimeSeconds,
      },
      update: {},
    }),
    `ensureGameSession(${roomCode})`
  );
}

async function gameIdFor(roomCode: string): Promise<string | null> {
  const prisma = db();
  if (!prisma) return null;
  const session = await prisma.gameSession.findUnique({
    where: { roomCode },
    select: { id: true },
  });
  return session?.id ?? null;
}

async function upsertPlayerByUsername(username: string): Promise<string | null> {
  const prisma = db();
  if (!prisma) return null;
  const player = await prisma.player.upsert({
    where: { username },
    create: { username },
    update: {},
    select: { id: true },
  });
  return player.id;
}

/** Marks the room IN_PROGRESS the first time a hand is recorded. */
async function markInProgress(gameId: string): Promise<void> {
  const prisma = db();
  if (!prisma) return;
  await prisma.gameSession.updateMany({
    where: { id: gameId, status: "WAITING_FOR_PLAYERS" },
    data: { status: "IN_PROGRESS" },
  });
}

export async function recordHandFinished(
  roomCode: string,
  summary: HandFinishedSummary,
  communityCards: string[],
  seatsSnapshot: { username: string | null; coins: number; seatIndex: number }[]
): Promise<void> {
  const prisma = db();
  const gameId = await gameIdFor(roomCode);
  if (!prisma || !gameId) return;

  try {
    await markInProgress(gameId);

    // Players + per-game session snapshots.
    const seen = new Map<string, { coins: number; seat: number }>();
    for (const s of seatsSnapshot) {
      if (!s.username) continue;
      seen.set(s.username, { coins: s.coins, seat: s.seatIndex });
    }
    for (const [username, info] of seen) {
      const playerId = await upsertPlayerByUsername(username);
      if (!playerId) continue;
      await prisma.playerSession.upsert({
        where: { gameId_playerId: { gameId, playerId } },
        create: { gameId, playerId, seat: info.seat, currentCoins: info.coins },
        update: { currentCoins: info.coins, seat: info.seat },
      });
    }

    // Hand history (supports split pots via JSON).
    await prisma.handHistory.upsert({
      where: { gameId_handNumber: { gameId, handNumber: summary.handNumber } },
      create: {
        gameId,
        handNumber: summary.handNumber,
        communityCards: communityCards.join(","),
        winnerData: json(
          summary.awards.map((a) => ({
            username: a.username,
            amount: a.amount,
            handLabel:
              summary.results?.find((r) => r.seatIndex === a.seatIndex)?.hand != null
                ? describeHand(summary.results.find((r) => r.seatIndex === a.seatIndex)!.hand)
                : null,
          }))
        ),
        potData: json(summary.pots),
        pot: summary.pots.reduce((sum, p) => sum + p.amount, 0),
      },
      update: {},
    });

    // Stats rollup per participant.
    const bestLabelBySeat = new Map<number, string>();
    for (const r of summary.results ?? []) {
      const label = describeHand(r.hand);
      const prev = bestLabelBySeat.get(r.seatIndex);
      if (!prev || label > prev) bestLabelBySeat.set(r.seatIndex, label); // stable pick
    }
    const wonBySeat = new Map<number, number>();
    for (const a of summary.awards) {
      wonBySeat.set(a.seatIndex, (wonBySeat.get(a.seatIndex) ?? 0) + a.amount);
    }

    for (const [username] of seen) {
      const seat = seatsSnapshot.find((s) => s.username === username)?.seatIndex ?? -1;
      const playerId = await upsertPlayerByUsername(username);
      if (!playerId || seat === -1) continue;
      const amountWon = wonBySeat.get(seat) ?? 0;
      const stat = await prisma.playerStats.upsert({
        where: { playerId },
        create: { playerId },
        update: {},
      });
      // NOTE: totalLosses stays a future field - awards carry winnings only.
      await prisma.playerStats.update({
        where: { playerId },
        data: {
          handsPlayed: { increment: 1 },
          handsWon: { increment: amountWon > 0 ? 1 : 0 },
          totalWinnings: { increment: amountWon },
          biggestPotWon: Math.max(stat.biggestPotWon, amountWon),
          bestHandLabel: bestLabelBySeat.get(seat) ?? stat.bestHandLabel,
        },
      });
    }
  } catch (err) {
    console.error("[persistence] recordHandFinished failed:", (err as Error).message);
  }
}

export async function recordRoomClosed(roomCode: string): Promise<void> {
  const prisma = db();
  const gameId = await gameIdFor(roomCode);
  if (!prisma || !gameId) return;
  swallow(
    prisma.gameSession.update({
      where: { id: gameId },
      data: { status: "ENDED", endedAt: new Date() },
    }),
    `recordRoomClosed(${roomCode})`
  );
}

/**
 * Twenty-Nine round summary. Reuses the HandHistory table with a JSON payload
 * (communityCards is empty - 29 has no board).
 */
export async function recordTnRoundFinished(
  roomCode: string,
  summary: import("@poker/shared-types").TnRoundSummary,
  players: { seatIndex: number; username: string | null; team: string }[]
): Promise<void> {
  const prisma = db();
  const gameId = await gameIdFor(roomCode);
  if (!prisma || !gameId) return;

  try {
    await markInProgress(gameId);
    for (const p of players) {
      if (!p.username) continue;
      const playerId = await upsertPlayerByUsername(p.username);
      if (!playerId) continue;
      await prisma.playerSession.upsert({
        where: { gameId_playerId: { gameId, playerId } },
        create: {
          gameId,
          playerId,
          seat: p.seatIndex,
          currentCoins: summary.matchScoreAfter[p.team as "A" | "B"] ?? 0,
        },
        update: { seat: p.seatIndex },
      });
    }
    await prisma.handHistory.upsert({
      where: { gameId_handNumber: { gameId, handNumber: summary.roundNumber } },
      create: {
        gameId,
        handNumber: summary.roundNumber,
        communityCards: "",
        winnerData: json([
          {
            winnerTeam: summary.winnerTeam,
            biddingTeam: summary.biddingTeam,
            bid: summary.bid,
            requirement: summary.requirement,
            captured: summary.captured,
            marriageTeam: summary.marriageTeam,
          },
        ]),
        potData: json(summary.captured),
        pot: 29,
      },
      update: {},
    });
  } catch (err) {
    console.error("[persistence] recordTnRoundFinished failed:", (err as Error).message);
  }
}

export async function recordLoanEvent(
  roomCode: string,
  fromName: string,
  toName: string,
  amount: number,
  kind: "LOAN" | "REPAY"
): Promise<void> {
  const prisma = db();
  const gameId = await gameIdFor(roomCode);
  if (!prisma || !gameId) return;
  swallow(
    prisma.loanRecord.create({ data: { gameId, fromName, toName, amount, kind } }),
    "recordLoanEvent"
  );
}
