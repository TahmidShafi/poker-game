-- Twenty-Nine game type marker on every session (existing rows stay poker).
ALTER TABLE "GameSession" ADD COLUMN "gameType" TEXT NOT NULL DEFAULT 'POKER';
