# RESUME MEMORY â€” Add Multiplayer "29" Game to Poker Website

**Status:** âœ… ALL PHASES COMPLETE (0â€“5). Full multiplayer Twenty-Nine shipped alongside untouched poker.
**Verification snapshot:** engine 55/55 Â· poker engine 111/111 Â· server integration 30/30 (24 poker + **6 new 29**) Â· tsc clean (web/server/engine) Â· all packages build.
**Remaining owner-side items:** run `npx prisma migrate deploy` against the real DB (migration `20260825120000_twentynine_game_type` adds `GameSession.gameType`); manual 4-browser-profile QA session if desired.
**Started:** 2026-08-25

## 1. Project context
- Repo `D:\poker-game-phase1\poker-game` â€” npm-workspaces monorepo, TS strict (`noUncheckedIndexedAccess` ON).
- Existing working product: **"Hold'em Club"** multiplayer Hold'em â€” **must not break**.
- Stack: Next.js 15 App Router (`apps/web`) Â· Express 4 + Socket.IO 4.8 (`apps/server`) Â· Postgres + Prisma 5 Â· `packages/poker-engine` (pure rules) Â· `packages/shared-types` (protocol) Â· NEW `packages/twentynine-engine` Â· Vitest.
- Server boots via `createPokerServer()` in `apps/server/src/index.ts` (also used by tests; production block skipped under VITEST).
- Live rooms are single-process in-memory (documented caveat, applies to 29 too).

## 2. Key files / integration map
- `apps/server/src/rooms/poker/gameManager.ts` (~881 lines) â€” poker authority. Pattern to copy: players Map<playerId,{socketIds,lastSeen,sessionToken}>, join/rejoin-by-token, disconnectSocket keeps seat, broadcastState loops ALL sockets and emits per-seat serialized snapshot, reject() emits ACTION_REJECTED.
- `apps/server/src/rooms/roomRegistry.ts` â€” codes/tokens/sweeper; currently maps codeâ†’GameManager directly â†’ being changed to RoomLike + factory.
- `apps/server/src/websocket/handlers.ts` â€” validationâ†’routing; `findRoomOf(registry,socketId)` walks roomsSnapshot(). CREATE_ROOM validates/clamps RoomConfig.
- `apps/server/src/rooms/poker/serialize.ts` â€” poker per-seat hole-card gate (pattern only).
- `apps/server/src/config.ts` â€” ServerConfig.limits (adding tnOfflineFallbackSeconds).
- `apps/server/src/persistence/persistence.ts` â€” fire-and-forget writers keyed by roomCodeâ†’gameSession.id; ensureGameSession upsert.
- `prisma/schema.prisma` â€” GameSession lacks gameType â†’ migration required.
- `apps/web/lib/store.tsx` â€” GameProvider: socket lifecycle, me/sessionToken/localStorage(TOKEN_KEY=poker.sessionToken), per-event listeners, bindAck; actions exposed via useGame().
- `apps/web/components/join/JoinScreen.tsx` + `join/CreateForm.tsx` â€” lobby; deep link ?room=CODE.
- `apps/web/app/page.tsx` â€” single page; renders JoinScreen OR poker table view.
- Reusable UI atoms: PlayingCard, sounds (playChips/playTurn/playWin), pushToast, confetti, glass/gold design classes. NO TimerRing in 29.
- Integration test pattern: `apps/server/src/__tests__/socket.integration.test.ts` boots real server on ephemeral port with 4 io() clients.

## 3. Owner-confirmed decisions (locked)
1. Classic Twenty-Nine; creator picks game at room creation (`gameType` on RoomConfig); joiners auto-detect via ack.
2. FOUR room-level trump modes: REGULAR (bidder privately picks suit) Â· SEVENTH_CARD (auto = 3rd card of bidder's SECOND batch; redeal same dealer if sole-suit dead card) Â· JOKER (best-effort default: J>9>A>10 power ranks across suits among legally played cards; isolated module) Â· MARRIAGE (4th mode; bidder secretly picks suit; K+Q holder side declares anytime during PLAYING; requirement bidâˆ’4 if bidding team, bid+4 if defending; server verifies possession).
3. Match = first team to N round-wins (default 6, clamp 1..15).
4. **NO turn timers for connected players.** Offline fallback ONLY: disconnected acting seat gets countdown (limit `tnOfflineFallbackSeconds`, default 120); expiry auto-acts bidâ†’pass / lowestLegalCard; never reveals trump. Reconnect cancels.

## 4. Rules digest (authoritative)
Teams A={0,2} B={1,3} Â· anti-clockwise cycle EXACTLY 0â†’3â†’2â†’1â†’0 (deal/bid/play/dealer rotate; dealer NEVER advances on cancelled hands) Â· 32-card deck 7â€“AÃ—4 Â· two batches of 4 Â· rank J>9>A>10>K>Q>8>7 Â· points J=3 9=2 A=1 10=1 Â· last trick +1 â‡’ Î£ MUST equal 29 (engine asserts) Â· flow deal4â†’bid(16â€“28, strict raises, pass=permanent out, ends when ONE active remains, all-passâ‡’redeal)â†’trump setupâ†’deal4â†’8 tricks Â· trump hidden until called (reveal â‰  playing; caller still plays normally; CALL allowed only void-in-led on your turn) Â· follow-suit mandatory Â· winner leads next Â· exactly 4 players; auto-start on 4th join; 5th join rejected Â· server-authoritative; reject duplicate/stale/out-of-turn (emit ACTION_REJECTED + log).

## 5. Architecture principles
29 fully separate from poker: separate engine pkg (done), separate manager class, separate UI components, separate protocol file. Shared ONLY: transport infra, generic UI atoms, additive `gameType` fields. Don't rewrite working poker code.

## 6. Phase checklist
- [x] **Phase 0** â€” this resume file.
- [x] **Phase 1** â€” shared-types: `src/twentynine.ts` (TnCard/TnTrumpMode/TnPhase/PublicTwentyNineState structurally excludes hidden data; private payloads YourTnHandPayload + TnBidderPrivatePayload{SEVENTH_CARD carries indicatorCard}; move payloads TnBid{bid?}/DeclareTrump{suit}/CallTrump{}/DeclareMarriage{suit}/PlayCard{card}) + events.ts additions (GAME29_* C2S Ã—5; TN_STATE/YOUR_TN_HAND/TN_BIDDER_PRIVATE/TN_TRICK_RESOLVED/TN_TRUMP_REVEALED/TN_ROUND_FINISHED/TN_MATCH_FINISHED S2C; optional gameType on RoomConfig/CreateRoomPayload/RoomAck; twentyNine?: {trumpMode,roundsToWin}). Builds clean; poker suites green.
- [x] **Phase 2** â€” `packages/twentynine-engine`: 55/55 tests green; exports createMatch/startHand(state,{deck?})/applyBid/declareTrump/callTrump/declareMarriage/playCard/moveOptionsForSeat/lowestLegalCard/toPublicTwentyNineState/getBidderPrivatePayload/tnTeamOfSeat/legalCards/tnCardPoints/TnEngineSeat/TwentyNineState. Notes: tnNextSeat=(i+3)%4; first bidder AND first trick leader = seat after dealer; pre-reveal trumps have no power; dealer rotates ONLY via dealerAdvancePending consumed by next startHand; REDEALING path keeps same dealer; MATCH_OVER when matchScore[winner]>=roundsToWin.
[x] **Phase 3 â€” SERVER (IN PROGRESS)**
  - [ ] `rooms/roomLike.ts`: interface RoomLike { roomCode; gameType: GameType; destroy(); isDestroyed(); lastActivityAt(); creationTime(); socketRoom(); join(username,opts):{ok...}|{ok:false,error}; attachSocket(playerId,socketId); findByToken(token); findPlayerBySocket(socketId); disconnectSocket(socketId); leave(socketId); reject(socketId,reason); broadcastState(); }  (GameManager implements implicitly â€” add `readonly gameType: GameType = "POKER"` field.)
  - [ ] `rooms/twentynine/twentyNineManager.ts` (NEW ~450 lines): mirrors GameManager plumbing (PlayerRecord map/token/socket tracking/join/rejoin/leave/disconnect); wraps engine state via createMatch({gameId,settings:{trumpMode,roundsToWin},seats}); auto-start when 4th joins (limits.autoStartDelayMs); routes five moves â†’ try/catch engine throw â†’ reject(socketId,msg) + console log; after EVERY successful mutation call afterMove(prevPhase,prevState): detect transitions â†’ emit TN_TRICK_RESOLVED (trick cleared & trickNumber advanced), TN_TRUMP_REVEALED (trumpRevealed flipped true), TN_ROUND_FINISHED (phase entered ROUND_SCORED/MATCH_OVER w/ lastRoundSummary), TN_MATCH_FINISHED (MATCH_OVER); on REDEALING just broadcast; private emits: YOUR_TN_HAND per connected seat after batch1/batch2 (batch field 1|2) and FULL_RECONNECT on rejoin; TN_BIDDER_PRIVATE to ALL bidder socketIds whenever getBidderPrivatePayload(state) returns non-null AND payload differs from last sent (track lastPrivateKey per round); offline fallback: single setTimeout armed whenever actingSeatIndex seat disconnected (recompute in syncFallbackTimer() called after every broadcast-relevant change + on disconnect/attach); expiry â†’ applyBid(pass) or playCard(lowestLegalCard) wrapped in try/catch; clear on reconnect/action/phase-exit. broadcastState(): loop all sockets of room members â†’ sio.emit("TN_STATE", {...toPublicTwentyNineState(state), offlineFallback: computed}); ALSO fill engine seat.connected flags before projecting. destroy(): clear timers, hooks.onRoomClosed?.  Hooks type TnManagerHooks { onRoundFinished?(data:{roomCode; summary:TnRoundSummary; players:{username|null;seatIndex;team}[]}): void; onRoomClosed?(code:string):void }.
  - [ ] `roomRegistry.ts`: Map<string,RoomLike>; createRoom(config): if config.gameType==="TWENTY_NINE" new TwentyNineGameManager(io,code,config,limits,hooks.tn) else new GameManager(...); keep allocateCode/sweep/findByToken (works via interface)/destroyAll.
  - [ ] `handlers.ts`: CREATE_ROOM â€” parse gameType (default POKER); if TWENTY_NINE validate twentyNine settings {trumpModeâˆˆ4 modes, roundsToWin int 1..15 default 6} and SKIP poker blind clamps (still require positive ints for startingCoins etc. â€” send defaults from client); include gameType in all three acks (CREATE/JOIN/RECONNECT) from room.gameType; new handlers GAME29_BID/GAME29_DECLARE_TRUMP/GAME29_CALL_TRUMP/GAME29_DECLARE_MARRIAGE/GAME29_PLAY_CARD: shape-validate (bid undefined|posintâ‰¤28; suit valid; card {suit,rank 7..14}) then findRoomOf â†’ if gameType!=="TWENTY_NINE" reject("not a 29 room") else call manager method (manager does authority checks).
  - [x] Prisma: schema GameSession += `gameType String @default("POKER")`; create migration SQL manually under prisma/migrations/<ts>_twentynine_game_type/migration.sql (`ALTER TABLE "GameSession" ADD COLUMN "gameType" TEXT NOT NULL DEFAULT 'POKER';`) since CLI migrate dev needs DB â€” check how prior migrations stored; update persistence.ensureGameSession to write gameType + twentyNine settings intoâ€¦ (blinds columns stay defaults); ADD recordTnRoundFinished(roomCode,summary,players) writing HandHistory row (handNumber=summary.roundNumber, communityCards:"", winnerData json summary, potData json captured, pot 0) + markInProgress.
  - [ ] `index.ts`: extend hooks wiring â€” pass {onRoomClosed, onRoundFinished: recordTnRoundFinished} into registry factory (registry receives both poker hooks + tn hooks; simplest: single GameManagerHooks extended? NO â€” define TnManagerHooks separately, registry constructor takes second param).
  - [x] Verify: tsc server --noEmit clean; poker integration suite still 24/24.
[x] **Phase 4 â€” WEB**
  - [x] store.tsx additive: state tnState:PublicTwentyNineState|null, myTnCards:TnCard[]|null, tnBidderPrivate:TnBidderPrivatePayload|null, tnTrickFlash counters; listeners TN_STATE(setTnState; also clear myTnCards on phase WAITING/REDEALING reset? keepâ€”batch flag guards), YOUR_TN_HAND(batch FULL_RECONNECT|1|2 â†’ setMyTnCards(payload.cards)), TN_BIDDER_PRIVATE(setTnBidderPrivate), TN_TRUMP_REVEALED(pushToast "trump revealed: X"), TN_TRICK_RESOLVED(playChips), TN_ROUND_FINISHED(playWin if my team won), TN_MATCH_FINISHED(confetti); actions tnBid(bid?),tnDeclareTrump(suit),tnCallTrump(),tnDeclareMarriage(suit),tnPlayCard(card) emitting GAME29_*; leaveRoom + failed reconnect reset tn slices; expose gameType = me?.config?.gameType ?? "POKER".
  - [x] JoinScreen Create tab: two-tab stays; ADD game picker segmented control (â™  Hold'em | â™¦ 29) ABOVE tab content when tab==='create'; when 29: render TnSettingsForm (trump mode select 4 options, roundsToWin stepper 1â€“15) instead of CreateForm; submit builds cfg={startingCoins:1000,smallBlind:10,bigBlind:20,turnTimeSeconds:60, gameType:'TWENTY_NINE', twentyNine:{trumpMode,roundsToWin}}.
  - [x] app/page.tsx: const is29 = me?.config?.gameType==='TWENTY_NINE'; render <TwentyNineView/> when is29 (after seated), keeping existing tree untouched otherwise.
  - [x] components/twentynine/: TwentyNineView.tsx (header: roomCode copy + leave + rules btn + sound; layout grid: left scoreboard, center table, right bid/trump info; mobile stacked); TwentyNineTable.tsx (fixed 4 seats N/E/S/W around felt; seat card: avatar letter disc or /avatars/i.png, username, cardsRemaining pips, dealer chip, acting ring-gold, DISCONNECTED dimmed+icon, TEAM color bar A=gold B=violet); TrickArea inside felt: 4 slots rotated per seat position showing played cards (reuse PlayingCard), winner flash via TN_TRICK_RESOLVED; HandFan.tsx (my cards fan bottom, tap-to-play enabled only when my turn, illegal dimmed via local mirror: ledSuit=trick[0]?.card.suit; legal=followers.length?followers:hand; CALL TRUMP pill when canCallTrump conditions; MARRIAGE pill listing suits where I hold K+Q); BiddingPanel.tsx (status: high bid/bidder/passed chips; when my turn: âˆ’/+ stepper min=max(16,highBid+1) max 28, BID + PASS buttons); TrumpPickerModal.tsx (opens when tnBidderPrivate.mode REGULAR|MARRIAGE && phase===TRUMP_SETUP: 4 big suit buttons); ScoreBoard.tsx (matchScore A/B toward roundsToWin, tricksWon, capturedPoints live, round #); RoundBanner.tsx (ROUND_SCORED overlay: bid/requirement/captured/winner + score; MATCH_OVER variant + "back to lobby" leave); RulesModal.tsx (static rules text incl. rankings/points/4 modes); reuse toast/sounds.
  - [x] Verify: npx tsc -p apps/web --noEmit; manual smoke later.
[x] **Phase 5 â€” VERIFICATION**
  - [ ] `apps/server/src/__tests__/twentynine.integration.test.ts` (NEW): boot createPokerServer({port:0, limits:{tnOfflineFallbackSeconds:1,...}}); helper connect4() creates TWENTY_NINE REGULAR room via client[0], others JOIN by code; collect per-client event logs (raw payloads) via wrapping socket.on handlers BEFORE awaitHelper; ADAPTIVE driver (deck uncontrolled): waitAllDealt (each client YOUR_TN_HAND batch1 len4), bidding: seat after dealer bids 16, everyone else PASS (order 0â†’3â†’2â†’1â†’0 relative dealer 0 â†’ first actor seat3? dealer starts 0 â†’ first actor 3: client3 bids16, clients 2,1,0 pass â†’ seat3 wins) ; bidder declares trump=suit of majority of own 8 cards (or first card suit); then loop: each TN_STATE â†’ if my turn & PLAYING: play lowest legal (client-side mirror) with small retry/backoff; until TN_ROUND_FINISHED. ASSERT: (a) per-client YOUR_TN_HAND batches disjoint, union=32 unique; (b) non-bidder clients never received TN_BIDDER_PRIVATE; (c) every TN_STATE at non-bidder clients pre-reveal had trump.state!=="REVEALED" AND post-reveal all have REVEALED+suit consistent; (d) exactly 8 TN_TRICK_RESOLVED each plays.length===4, union of trick cards == 32; (e) TN_ROUND_FINISHED captured sums 29; (f) final states cardsRemaining 0. THEN: out-of-turn rejection test (emit GAME29_PLAY_CARD while not acting â†’ expect ACTION_REJECTED). SEVENTH_CARD room: same driver but tolerate REDEALING loop (retry startHand up to 3 redeals) then complete hand. JOKER room: complete hand (no declare step; skip call). MARRIAGE: complete hand (declare only if bidder holds K+Q of declared suit â€” optional). OFFLINE fallback: limits tnOfflineFallbackSeconds=1; during BIDDING disconnect client (socket.disconnect()); expect within ~5s a PASS recorded for them (TN_STATE bids.history grows / passed includes seat) and auction continues. Also poker regression: full `npm test`.
  - [x] Whole workspace: `npm run build` order shared-typesâ†’twentynine-engineâ†’poker-engineâ†’server; `npm test` (engine 111 + tn 55 + server poker 24 + new 29 integration); tsc web.
  - [x] render.yaml: add twentynine-engine to build command chain if listed explicitly (check file).
  - [x] Manual QA note for owner (4 browser profiles) â€” cannot be automated here.
  - [x] Update this checklist; final report to owner.

## 7. Commands
- Install/build: `npm install`; `npm run build -w @poker/shared-types -w @poker/twentynine-engine`
- Tests: `npm test` (runs poker-engine then server workspaces); `-w @poker/twentynine-engine`
- Typecheck: `npx tsc -p apps/server --noEmit`; `npx tsc -p apps/web --noEmit`
- Dev: `npm run dev` (web :3000, server :4000)

## 8. Gotchas learned so far
- Anti-clockwise means first bidder/leader after dealer 0 is **seat 3**, dealing order [3,2,1,0]. Ordered-deck reference hands: P3:S7,SJ,H7,HJ|D7,DJ,C7,CJ Â· P2:S8,SQ,H8,HQ|D8,DQ,C8,CQ Â· P1:S9,SK,H9,HK|D9,DK,C9,CK Â· P0:S10,SA,H10,HA|D10,DA,C10,CA.
- Teams: A=even seats {0,2}, B=odd {1,3}. Tests previously tripped on this.
- `resolveWinner` requires exactly 4 plays. Vitest does NOT typecheck â€” always run package `build` too.
- Prisma CLI migrations need DATABASE_URL; write migration folder manually + rely on `prisma migrate deploy`/db push by owner (persistence degrades gracefully without DB anyway).
- PowerShell: no `&&` â€” use `; if ($?) { ... }`. No ripgrep â€” use Grep tool.

---

## 9. PENDING IMPLEMENTATION BATCH â€” saved 2026-08-25 19:43 (Tue)
**Status: PLANNED, NOT STARTED. Owner approved specs; implementation awaits go-ahead.**
All work is 29-scoped only â€” poker files are NEVER modified (owner instruction, standing).

### Batch A â€” settings-free lobby + integrated trump choices (approved earlier, unbuilt)
1. **Lobby**: delete `apps/web/components/join/TnCreateForm.tsx`; JoinScreen 29 path sends only `{startingCoinsâ€¦defaults, gameType:"TWENTY_NINE"}` â€” NO settings shown. Match target fixed at **6 rounds** universally (engine default; keep optional test override).
2. **Protocol** (`shared-types/twentynine.ts`, `events.ts`): remove `TwentyNineRoomSettings` + `twentyNine` from RoomConfig/CreateRoomPayload. `PublicTwentyNineState`: replace room-level `trumpMode` with per-hand resolved style `"SUIT" | "SEVENTH_CARD" | "JOKER"` (null until bidder decides). `TnDeclareTrumpPayload` â†’ `{ choice: TnSuit | "SEVENTH_CARD" | "JOKER" }`.
3. **Engine**: `createMatch` drops settings param; TRUMP_SETUP waits for bidder's choice and dispatches to existing suit / seventh (incl. sole-suit redeal) / joker modules unchanged.
4. **Server**: `validateRoomConfig` drops the twentyNine branch entirely (just stamp gameType); handler forwards new payload shape.
5. **Web**: TrumpPickerModal = 6 tiles (â™  â™¥ â™¦ â™£ Â· 7th Card Â· Joker). TrumpBanner/RulesModal show current hand style; rules text states "first to 6 rounds".
6. **Tests**: engine tests parameterize by choice; integration creates rooms with no twentyNine field and drives each branch.

### Batch B â€” four fixes (specs confirmed via Q&A same day)
1. **Avatar path fix**: `apps/web/components/twentynine/parts.tsx` line ~23 â†’ ``src={`/avatars/avatar-${avatar}.png`} `` (files on disk are avatar-N.png; current code requests wrong name). One line.
2. **Traditional Bangladeshi score cards** (replace numeric ScoreBoard):
   - NEW `components/twentynine/ScoreCard.tsx`: authentic playing-card face (white gradient, corner labels `{count}{suit}` both corners, bottom-right rotated), REAL pip layouts for counts 0â€“6: 0 blank Â· 1 center Â· 2 vertical pair (bottom pip rotated) Â· 3 diagonal Â· 4 corners Â· 5 corners+center Â· 6 two columns of three. `inverted` prop flips ALL pips+labels 180Â°.
   - Team A pair: â™¥ card (+wins) + inverted â™  card showing LOSSES (= opponent round-wins). Team B pair: â™¦ + inverted â™£. Count 6 â‡’ gold glow flourish.
   - `globals.css`: add `scorePop` keyframe (scale-up + tilt settle); cards re-key on roundNumber so changed team pops once per round.
   - Placement: horizontal strip centered ABOVE the felt (replaces left-sidebar numeric board entirely). Small caption identifies teams + highlights viewer's pair.
   - Round-end sequence already wired: winner banner + bid/captured â†’ card pop animation â†’ server auto-starts next hand (~4 s).
3. **Self-always-at-bottom seats**: relative mapping `rel=(seatIndex-mySeat+4)%4`; rel0=bottom(you), rel2=top(partner), rel3=right(next actor), rel1=left(prev). Apply in `TwentyNineView.tsx` POS map AND `parts.tsx` TrickArea slot map (pass mySeat down) so played cards sit beside the right player. Preserves true anti-clockwise visual flow.
4. **Bidding rules v2** (`engine/bidding.ts` + `game.ts applyBid` passes seatIndex):
   - First bid any 16â€“28. Own team holds high bid â‡’ strictly higher ONLY ("partner bids 18 â†’ other partner may go 19"; never equal own side).
   - Opposing team holds â‡’ strictly higher OR exact MATCH, but a value is matchable ONCE: legal iff `history` contains exactly one prior bid of that value (no 17â†”17 ping-pong; at 28 a match is the final action, then passes end auction normally).
   - Pass = permanent out; end when one active remains; zero-bid same-dealer redeal â€” all unchanged.
   - Error strings: "must be higher than your partner's bid" / "that bid is already matched".
   - Web mirror: `panels.tsx` BiddingPanel floor = H when opponents hold unmatched H else H+1; caption "(match H)" when available. Server always re-validates.
   - Tests: rewrite strict-only case; add partner-strict, legal match, double-match reject, own-side equal reject, match-at-28 termination, teammate-first-bid freedom. Integration driver unaffected.

### Suggested execution order
Batch A (protocol/engine first since B touches same files) â†’ B4 bidding â†’ B1 avatar â†’ B3 seats â†’ B2 score cards â†’ full verify (engine build+tests, server tsc+tests incl. poker 24, web tsc) â†’ update this checklist â†’ commit+push (owner pushes explicitly).


## 10. PROGRESS LOG (checkpoint after each todo)
- [2026-08-25 21:35] DONE: shared-types protocol rewrite + ENGINE rewrite (settings-free createMatch default 6 rounds; declareTrumpPlan choice dispatcher; bidding v2 partner-strict/match-once; private payload kinds) - build OK, tests 58/58.
- [2026-08-25 21:36] DONE: SERVER (settings-free validateRoomConfig; vsBots through registry+manager w/ persistence skip; choice routing; botBrain.ts casual heuristics + fillBots/armBotIfNeeded/performBotMove; offline-fallback skips bots) AND WEB (avatar path fix avatar-N.png; viewer-relative seats in view+TrickArea; ScoreCard.tsx pip layouts 0-6 inverted loss side; scorePop anim in tailwind config; TraditionalScoreCards strip above felt; 6-tile TrumpPickerModal; RulesModal rewrite; BiddingPanel v2 floor + match caption; store choice payload + vsBots extra; JoinScreen friends/bots buttons; TnCreateForm deleted). Server tsc OK, Web tsc OK.
NEXT: update twentynine integration suite to new API (no modes, choice payload) + add bots single-player integration test; then full verify + commit.
- [2026-08-25 22:25] ALL BATCHES COMPLETE. Integration suite 7/7 rewritten for choice-API (SUIT/SEVENTH/JOKER/marriage/out-of-turn/offline-fallback/BOTS). Bot test: table auto-fills 3 bots, full round vs bots legal, no substantive rejections. Full verify: tn-engine 58/58, poker-engine 111/111, server 31/31, web+server tsc clean. Bots shipped: botBrain casual heuristics (bidding v2 aware), vsBots flag, think-delay loop through human pipeline, persistence skipped for bot rooms.
- [2026-08-25 23:14] P1 DONE: store hand-accumulation fix (YOUR_TN_HAND batch 1/2/FULL_RECONNECT keyed by handNumber - root cause of missing second deal), observed-played derivation from TN_STATE+TN_TRICK_RESOLVED, pendingTnCard lift/clear-on-reject, trickFlash winner snapshot. Web tsc OK.
- [2026-08-25 23:15] P2 DONE: CardBack.tsx (authoritative-count backs) + CardFan.tsx (fanCardStyle rotation/arc/overlap math + BackFan container).
- [2026-08-25 23:16] P3 DONE: HandFan rebuilt on fanCardStyle (arc+rotation+overlap, hover-lift legal only, pending lifted gold, illegal dimmed, display hand = dealt minus observedPlayed); OpponentHand.tsx back-fans top horizontal / sides vertical driven by cardsRemaining.
- [2026-08-25 23:22] P4+P5 DONE: TrickArea v2 (directional dealIn per seat, winner card gold pulse from trickFlash, collect-out toward winner seat using snapshot during 600ms window); RedealBanner explanation; SeatCard bot/bid-winner badges; captured tricks+pts chips on score captions; TwentyNineView rebuilt as h-dvh flex column (header/score strip/flex-1 felt with opponent back-fans/fixed dock: bidding+pills+hand) - no page scroll, responsive. Web tsc OK.
- [2026-08-25 23:25] P6 DONE: full verify - poker-engine 111/111, server integration 31/31 (incl. bots round), web tsc clean. Table redesign complete: card lifecycle hand->trick->winner-highlight->collect-to-winner-seat->captured chips; second-deal bug fixed via batch accumulation. Awaiting owner manual QA of section-20 checklist.
