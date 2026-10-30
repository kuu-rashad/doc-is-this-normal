# Doc, is this normal? — Game Design

## Summary

- Local multiplayer party game in the style of Jackbox games, played in the background of a company party.
- No rooms: everyone plays in the same game.
- One computer shows the big screen website for the whole party; players join by scanning its QR code with their phones.
- Players write silly symptoms as patients, prescribe treatments as doctors, and vote on the funniest symptom + prescription pairs.
- Not realtime: players act at their own pace. Phones check the game state every 10 seconds on their home screen but never redirect a player who is busy writing or voting.
- The only shared moments happen on the big screen, announced by a waiting-room chime: the start of the Finals and the reveal of the winner.

## Joining

1. The player scans the QR code on the big screen, which opens `/play`.
2. They enter a nickname (up to 16 characters, unique, case-insensitive) and pick one of 12 avatars (shown in a random order; avatars don't need to be unique).
3. They land on the phone home screen, which shows their avatar and nickname, the current phase, the time left in it, and only the actions that phase allows.

- The phone remembers the player with a random id saved in the browser, so returning players skip straight to the home screen.
- Players can change their nickname or avatar from the home screen at any time.
- New players can join during any phase.
- Names are shown as plain nicknames everywhere, except that a player is called "Dr. <nickname>" when they're the author of a prescription.

## The round

The game repeats this cycle for the whole party.

| Phase | Default length | What players can do on their phones |
|---|---|---|
| Clinic open | 45 min in round 1, 30 min after | Write a symptom, treat a patient, vote |
| Second opinions | 15 min | Vote only (a grace period for the clinic) |
| Finals | 15 min | Pick one favourite among the finalists |
| Reveal | 2 min, on the big screen | The next round's Clinic open has already started |

- Phase lengths are configurable in the admin panel on the night, with a separate (longer) length for the first Clinic open.
- If nobody qualifies for the Finals, the Finals are skipped and the next round starts.
- **Everything from a round retires when it ends**: symptoms, prescriptions and votes are cleared. Only the winner lives on, in the Hall of Fame. Player points carry over between rounds.

## Patient mode (writing a symptom)

- The player gets a random symptom template with one blank, e.g. "Whenever I open my inbox, I get an uncontrollable urge to ____."
- The blank is free text (up to 40 characters; the whole symptom up to 160), with a short hint above it.
- **Surprise me** fills the blank at random from the template's pool, for players who can't think of anything.
- (Suggestion chips under each blank exist in the code but are switched off for now.)
- After submitting, the player goes straight on to treat a patient.

### Walk-in patients

- Every round starts with a set of premade "walk-in" symptoms, one per template, so early doctors always have someone to treat.
- Their patient is shown as "Walk-in Patient" (configurable).

### Template guidelines

- Templates describe something ongoing or recurring that the patient wants help with, not a one-off story.
- Validation test: a doctor answering "And how long has this been going on?" should make sense.
- Company-specific references are encouraged: Slack, Google Meet, making games for clients, and HR being on leave.
- Templates are grouped into five tiers, from mild to after-hours. All tiers are currently mixed from round 1.

## Doctor mode (writing a prescription)

- The player gets a symptom from the pool: never their own, and never one they've already treated.
- Symptoms with exactly one prescription come first (one more makes them votable), then untreated ones, then the rest.
- The symptom is shown as a quote from the patient. Below it is a random prescription frame with one blank, e.g. "Take ____ and call me in the morning."
  - The dice button next to the frame switches to another wording.
  - **Surprise me** fills the blank at random.
  - **Write my own** switches to free text (up to 120 characters).
- Frames are written so the fill can twist their meaning into something absurd, pervy or rude ("Take my hand and call me in the morning").
- An identical prescription for the same patient is refused with "Another doctor already told me this." (case, spacing and punctuation are ignored).
- After prescribing, the player gets one vote, then returns home.

## Voting

- A vote shows two symptom + prescription **pairs**, which may come from different symptoms.
- The player taps the funnier pair, and can optionally star any one of the four sentences (two symptoms, two prescriptions). Both are optional; with neither, the vote is a skip.
- Pairs that have been shown the least come first, and a player never sees the same two pairs twice.
- Players can vote on pairs that include their own writing.
- Voting opens as soon as the round has two prescriptions.

## Finals

- When Second opinions ends, every symptom is ranked by its best pair's **win rate** (times picked as funnier ÷ times shown). A pair needs at least 3 showings to count.
- The top 3 symptoms become the finalists (one pair each).
- On the big screen: chime, large countdown, and the finalists side by side without names.
- On phones: a ballot with the same finalists. Each player picks one favourite and can change their pick until the Finals end.
- Players can vote for pairs that contain their own writing.
- Winner: most finals votes; ties go to the higher win rate, then the earlier prescription.

## Reveal

- At the end of the Finals the big screen shows "Winner!" with the winning pair and the names of its patient and doctor, for the reveal length.
- The winner joins the Hall of Fame.

## Scoring

| Action | Points |
|---|---|
| Submit a symptom | +1 |
| Submit a prescription | +2 |
| Vote (pick a pair, star a sentence, or make a first finals pick per round) | +1 |
| Your pair is picked as the funnier one | +1 to its patient and +1 to its doctor |
| Your sentence gets a star | +1 to its author |
| Finals: 1st / 2nd / 3rd place | +10 / +8 / +6 to both the patient and the doctor |

Walk-in symptoms have no patient to score. Points add up across rounds; "Reset game" sets them back to 0.

## Big screen

- **Top left:** the game logo.
- **Top right:** buttons for scoring info, mute, and settings. Under them, the phase card (round number, phase name with its colour and icon, countdown "until <next phase>") and the TOP 3 leaderboard with gold, silver and bronze ranks ("Earn your place in the top 3" until anyone scores).
- **This round's leaders:** the current finals candidates as clipboard cards (the patient's note with avatar, name and symptom; "Doctor's notes:" with the prescription and the doctor; a badge with how often the pair was picked). Three at a time, cycling every 10 seconds; text shrinks or grows to fit each card.
- **Hall of Fame:** past winners as speech-bubble + clipboard cards above the players bar, a few at a time with a countdown ring before the next set. An outlined placeholder when there are no winners yet.
- **Players bar:** every player's avatar and nickname along the bottom, scrolling when they don't all fit.
- **QR code:** on a bandage in the bottom-right corner ("SCAN ME!"), styled like blood on the pad.
- **Finals view:** big countdown and the finalists side by side; most other sections are hidden.
- **Reveal view:** the winning pair with names.
- **Background:** blue gradient with a slowly scrolling pattern of crosses and syringes.

### Sound

- Background music per phase, two tracks each (Clinic open, Second opinions, Finals), played in turn. Each track fades in and out, with 5–10 seconds of silence between tracks and when the phase changes.
- The chime plays when the Finals start and when the winner is revealed.
- Music and sound-effect volumes and a mute button are in the corner. Browsers need one click on the page before any sound plays.

## Admin

- The settings popup always shows the music and sound-effect volumes, and a "Show sample data" switch with a phase preview for checking the layout (only in that browser, off again after a reload).
- Everything else needs the admin password, which is stored as the `ADMIN_PASSWORD` secret on Cloudflare and asked every time the popup opens:
  - phase lengths;
  - skip to next phase, restart this round;
  - reset game (clears all rounds, votes, points and the Hall of Fame; keeps players);
  - delete all players and data.
- The ⓘ button shows the scoring rules (no password).

## Content and configuration

All game content and tuning lives in `assets/gameconfig.json`:

- symptom templates (by tier) with hints and random-fill pools, and the walk-in symptoms;
- prescription frames and their fill pools (shared pools, or pools written for one frame);
- phase lengths, finalist count and minimum showings, text limits, and point values;
- the walk-in patient's name.

## Not done yet / ideas

- Unlocking spicier tiers in later rounds instead of mixing all tiers from round 1.
- A way for the admin to remove inappropriate entries or players without resetting the game.
- Showing players their own score on their phone, and the scoring rules on the phone.
- Exporting the Hall of Fame and scores after the party.
