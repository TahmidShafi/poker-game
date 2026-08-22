-- DropForeignKey
ALTER TABLE "HandHistory" DROP CONSTRAINT "HandHistory_winnerId_fkey";

-- DropIndex
DROP INDEX "PlayerSession_gameId_seat_key";

-- AlterTable
ALTER TABLE "GameSession" ADD COLUMN     "endedAt" TIMESTAMP(3),
ADD COLUMN     "roomCode" TEXT NOT NULL,
ADD COLUMN     "turnTimeSeconds" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "HandHistory" DROP COLUMN "winnerId",
ADD COLUMN     "potData" JSONB NOT NULL,
ADD COLUMN     "winnerData" JSONB NOT NULL;

-- CreateTable
CREATE TABLE "LoanRecord" (
    "id" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "fromName" TEXT NOT NULL,
    "toName" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoanRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "GameSession_roomCode_key" ON "GameSession"("roomCode");

-- CreateIndex
CREATE UNIQUE INDEX "HandHistory_gameId_handNumber_key" ON "HandHistory"("gameId", "handNumber");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerSession_gameId_playerId_key" ON "PlayerSession"("gameId", "playerId");

-- AddForeignKey
ALTER TABLE "LoanRecord" ADD CONSTRAINT "LoanRecord_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "GameSession"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
