-- CreateTable
CREATE TABLE "Player" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Player_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameSession" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "startingCoins" INTEGER NOT NULL,
    "smallBlind" INTEGER NOT NULL,
    "bigBlind" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerSession" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "seat" INTEGER NOT NULL,
    "currentCoins" INTEGER NOT NULL,

    CONSTRAINT "PlayerSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HandHistory" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "handNumber" INTEGER NOT NULL,
    "communityCards" TEXT NOT NULL,
    "winnerId" TEXT,
    "pot" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HandHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerStats" (
    "playerId" TEXT NOT NULL,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "handsPlayed" INTEGER NOT NULL DEFAULT 0,
    "handsWon" INTEGER NOT NULL DEFAULT 0,
    "totalWinnings" INTEGER NOT NULL DEFAULT 0,
    "totalLosses" INTEGER NOT NULL DEFAULT 0,
    "biggestPotWon" INTEGER NOT NULL DEFAULT 0,
    "bestHandLabel" TEXT,

    CONSTRAINT "PlayerStats_pkey" PRIMARY KEY ("playerId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Player_username_key" ON "Player"("username");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerSession_gameId_seat_key" ON "PlayerSession"("gameId", "seat");

-- AddForeignKey
ALTER TABLE "PlayerSession" ADD CONSTRAINT "PlayerSession_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "GameSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerSession" ADD CONSTRAINT "PlayerSession_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandHistory" ADD CONSTRAINT "HandHistory_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "GameSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HandHistory" ADD CONSTRAINT "HandHistory_winnerId_fkey" FOREIGN KEY ("winnerId") REFERENCES "Player"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerStats" ADD CONSTRAINT "PlayerStats_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
