# Keyboard MIDI XR flow

Id: keyboard-midi-xr-flow
Status: Setup hub direction agreed 2026-11-24 and the XR screens below were rewritten to match. Layout is provisional until the mock (RockyRoad-kqg), and copy is a draft. A desktop flow is proposed below, not agreed. Desktop test results are in [[keyboard-midi-input]].

User flow and screens for choosing and connecting an input (None, Mic or MIDI) in XR, built on the Quest results in
[[keyboard-midi-input]] and the mic flow in [[tuner-compact-layout]] (RockyRoad-0q4.5, .9, .12, .15).
Permission work is RockyRoad-lha.

## What the tests fix

- A permission prompt ends the XR session within about 100 ms, for MIDI (16 ms) and for the mic
  (99 ms). The button that makes the request must say "Exit VR".
- `permissions.query({ name: 'midi' })` reports `prompt`, `denied` and `granted` before any request.
- A request in `denied` fails in about 9 ms with `NotAllowedError`. In `granted` it resolves in
  2 to 18 ms and the session stays open, so it is safe to call on every entry.
- Access with no keyboard gives `inputs: []`. Plug-in, unplug and replug are picked up by
  `statechange` with no re-request, on the flat page and inside XR.
- Without permission the page sees nothing, and plugging in raises no system UI.
- A connected port doesn't prove notes arrive, so setup should wait for a real key press.
- `permission-change` was never seen firing, so poll the state once a second like the mic does.

## Entry point

- The Song page secondary slot is Setup (wrench icon) for guitar and keys. Setup opens the Setup
  screen, which holds the Input dropdown. Play never opens it on its own.
- Play uses the saved Input. If that input is Mic or MIDI and not ready, Play opens the not-ready modal
  (screen 5). Input None plays unscored with no prompt.
- There is no separate requirements page. Each input's requirements are the first line of its card.
  The decisions behind all of this are in "Setup hub" below.

## Navigation rule

The corner button always reads Song and leaves to the Song page. There is no step back inside Setup.
The bottom bar holds Reposition at bottom left, only when a saved calibration exists, and Play at
bottom right. There is no forward button, since the cards are the actions. Play is dark while the chosen
input is not ready and light once it is. Re-entering after a session exit reopens Setup on the saved
Input.

## Screens

One Setup screen with an Input dropdown near the top. Keys offers None, Mic and MIDI. Guitar offers
None and Mic. The middle of the screen follows the choice. Copy is a draft and diagrams are not to scale.
Layout is being mocked in RockyRoad-kqg, so treat positions as provisional.

### 1. Input None

```
 [< Song]
 Input [None v]
   Playing without scoring.
 [Reposition]                          [> Play]
```

- No cards and no permission. Play goes straight to the song.

### 2. MIDI: requirements and keyboard checklist

Shown when MIDI is selected and permission is `granted`, and after a re-entry that follows an accepted
prompt. The requirements line replaces the old requirements page and fits easily (37 characters against
a line limit of about 41).

```
 connect                      press a key                  done
 [< Song]                     [< Song]                     [< Song]
 Input [MIDI v]               Input [MIDI v]               Input [MIDI v]
 Needs a MIDI keyboard and    v Connect keyboard           v Connect keyboard
 USB-C cable.                 * Press any key              v Press any key
 * Connect keyboard               Checking it sends notes.
     Plug it in with the
     cable.
 o Press any key
 [Reposition]   [> Play]      [Reposition]   [> Play]      [Reposition]   [> Play] (light)
```

- Row 2 stays dimmed until row 1 is done. Row 1 is done when a port connects, row 2 when the first
  Note On arrives. Both are driven by `statechange` and `onmidimessage` with no re-request.
- The checklist opens at the first row that isn't done, so a user with a keyboard already attached lands
  on "Press any key". The requirements line shows only until a keyboard connects.
- Play is dark while setup is incomplete and light once both rows are done. The checklist stays on the
  done state until the user presses Play, so the success is visible.
- A keyboard that disconnects during play pauses the song and reopens Setup at "Connect keyboard" with the
  second row reset. Pause and resume is not built in XR yet and has no bead, so until then the input just
  stops responding. The HUD input indicator in "Setup hub" is the planned home for this.

### 3. Permission cards (MIDI and mic)

The mic's `warn-card` shape: a title, up to four short lines and one button. Each line fits on one line
(about 41 characters at 1.2). The card replaces the card body under the Input dropdown.

```
 prompt                           blocked
 [< Song]                         [< Song]
 Input [MIDI v]                   Input [MIDI v]
   MIDI permission needed           MIDI blocked for this site
   The prompt shows in the          Exit VR for the fix steps.
   2D browser.                      Steps are in the browser, not Settings.
   [Exit VR]                        [Exit VR]
 [Reposition]   [> Play]          [Reposition]   [> Play]
```

- `prompt`: Exit VR makes the `requestMIDIAccess()` call. The browser ends the session and shows the
  prompt on the flat page. The user answers, then re-enters.
- `denied`: Exit VR ends the session and the flat page shows the toast with the unblock steps below.
- The card is hidden while the state is still unknown, so the wrong text never flashes.
- The card polls the permission once a second, as `_recheckPermission` does, so a change made outside
  VR moves the screen on.
- Mic uses the same shapes with the tuner's existing text (`MIC_CARD_TEXT`: `prompt`, `siteBlocked`,
  `appBlocked`).

### 4. Mic card

```
 [< Song]
 Input [Mic v]                        (guitar: Restart icon at the right)
 +------------------------------------------------+
 | Mic [Default v]   Level ||||....   Gain ===o-- |
 +------------------------------------------------+
 (guitar: tuner boxes below)
 [Reposition]                          [> Play]
```

- The device dropdown, meter and Gain slider reuse the tuner's elements in a card background like the
  Song page metadata. Guitar shows the tuner boxes below, and Play acts as Done.

### 5. Not-ready modal

```
 +---------------------------+
 |  MIDI isn't ready         |
 |  Skip scoring?            |
 |  [Fix]          [Skip]    |
 +---------------------------+
```

- Shown on Play when Input is Mic or MIDI and not ready. Fix stays on Setup. Skip plays unscored with
  Input set to None for that play.

## Flow

```
Song page -- Setup --> Setup screen, Input = saved choice (default None)
                          |
        None              Mic                          MIDI
          |                |                             |
     no cards        read mic permission          read MIDI permission
                  prompt  denied  granted        prompt  denied  granted
                    |       |        |             |       |        |
              permission blocked  mic card   permission blocked  requirements
              card       card     (ready)    card       card     + checklist
          Exit VR = request  Exit VR = end   Exit VR = request  Exit VR = end
                    |       |                    |       |
              session ends, flat page       session ends, flat page
              prompt or toast               prompt or toast
                    |       |                    |       |
              user re-enters, Setup reopens on the saved Input, permission read again

Play from Setup or the Song page:
  input ready, or Input None  -> play (scored when ready)
  Mic or MIDI not ready       -> modal: Fix (stay on Setup) or Skip (play unscored, Input None)
```

Corner button on every screen: Song, leaving to the Song page.

## How state reaches the user in XR

- There is no in-session toast system. The only toast is the flat-page one
  (`showMicSiteBlockedToast` in `MicPermission.ts`), which appears after an exit.
- In-session messages are cards on the panel (the tuner's `tn-mic-card` and `tn-warn`). The MIDI
  cards and checklist are the equivalent and the one place state is shown. An in-session toast system
  is planned for transient events, see "Setup hub".
- The mic's cards sit inside the tuner's `tn-boxes` region, so Setup needs a panel of its own: a header
  with the Song button, the Input dropdown, the cards and the modal scrim. It hand-duplicates the card
  classes from `ui/tuner.uikitml`, as the other panels do.

## Unblock steps for the blocked toast

Not in the Horizon OS browser settings. They go through Chromium's own settings page:

1. In a new tab, open `chrome://settings`, then Site Settings > All Sites.
2. Find the site and set "MIDI device control & reprogram".
3. That page renders on top of the browser tabs, so the way back is the back button at the top left.

A page can't open it. Links to `chrome://settings` and its MIDI deep link did nothing and
`window.open` returned `null`, so the toast shows these steps as text only. The toast needs the
back-button note, since the user can get stuck. The mic's steps are different (Browser app settings >
Privacy and Security > Website Permissions > Microphone). The exact option names on the Chromium page
are not recorded, so check them before writing the copy.

## XR screen design notes

Built from the current code: `ui/song.uikitml`, `ui/tuner.uikitml`, `XRPreScene.ts` and
`XRTunerScene.ts`. Panels are a fixed 40 x 30 cm, 1 unit = 1 cm.

### Where the mic had to tweak content to fit

- **No wrapping.** Card lines are one span each at a fixed width (card 31 wide, 1.2 font), so every
  line has to fit on its own. The longest mic line that fits is about 41 characters. The weak-mic
  card splits a two-line sentence into two spans by hand.
- **Long steps left the panel.** The Settings path no longer fits on the card. The card keeps a title
  and one line, and the full path moved to a flat-page toast after the exit.
- **Buttons were dropped.** The permission card lost its Back button because the Song button in the
  header already leaves. It keeps one button, labeled Exit VR even when it makes the request.
- **Setup moved to full-panel pages.** The requirements text didn't fit as a card, so page 1 replaces
  the whole panel: title 2.4, bullets 1.5, grey sub-bullets 1.2, a footer line, and the Play and
  Continue buttons in the bottom bar. Its body padding was also reduced (`page-body-low`).
- **Wrong text flashed.** The card is hidden while the permission state is unknown, and the waiting
  overlay holds until the mic and input list are ready.
- **Repeats were capped.** Page 1 and the reminder show once per page session.

### Fit estimate

Not measured in a headset. Line height is assumed at 1.3 times the font size, with a 40 x 30 panel,
about 4.6 cm for the header and 4.6 cm for the bar.

| Screen | Estimated height | Available body |
| --- | --- | --- |
| Tuner page 1 (built, fits) | about 19.8 cm | about 20.8 cm |
| Permission card, worst case (title, 4 lines, button) | about 15.5 cm | about 20.8 cm |
| Keyboard checklist, two rows and one sub-line | about 11 to 12 cm | about 20.8 cm |

Page 1 is the calibration point and leaves about 1 cm. These estimates predate the hub. The Input
dropdown row now sits above every card, and the guitar screen adds the mic card and two tuner boxes,
so the hub's fit is unmeasured and is a mock question (RockyRoad-kqg).

### Slot conflict on the Song page (resolved)

- The Song page action bar has room for two buttons. Reposition, Tune and Play at 15 cm each would be
  47 cm in a 38 cm bar.
- The Setup hub resolves it. The secondary slot becomes Setup for guitar and keys, and Reposition moves
  onto the Setup screen. Reposition also stays in the Play HUD (`as-reposition` in `play.uikitml`).
- Icon: Setup uses a wrench based on OpenMoji (RockyRoad-9f2), not the settings gear. The instrument
  icon `Keys_White.svg` is stroke-only and would need an Image element, so it is not used.

## Differences from the mic flow

- No `appBlocked`. No OS-level toggle for MIDI has been found, and a granted request returned in
  2 ms every time. If one exists, its signature would be state `granted` with a request that never
  settles.
- The keyboard checklist and the disconnect pause have no mic counterpart.
- The mic's `prompt` path has no page toast after the exit, so a dismissed prompt leaves the user on
  the flat page with no hint. Reusing the `siteBlocked` toast for MIDI's prompt path is worth
  considering for both.
- `MIC_CARD_TEXT`, the mic-named toast and `MicPermission.ts` need the permission type as a
  parameter, or a MIDI twin.

## Desktop flow (proposed 2026-11-21)

Desktop differs from XR in three ways. The prompt is inline and nothing ends, so there are no Exit VR
cards. Desktop has no Reposition, so its Setup screen has only Play in the bar. The same Setup hub applies
otherwise, and the desktop mic Input select, level and Gain from the tuner are reused for the Mic option. Chrome or Edge is the tested browser (see
[[keyboard-midi-input]]). The shared permission helper is RockyRoad-7wy.

### Desktop mic today, for comparison

```
Song page: [Tune] (stringed only)      [> Play]
              |                           |  shouldAutoTune? yes -> TunerScreen, no -> ActiveSceneScreen
              v                           v
         TunerScreen mount()        ActiveSceneScreen.setupNoteDetection()
         PitchDetector.create()     (stringed with tuningOffsets only, micRequested guard)
              |                           |
         "Waiting for mic access"    inline browser prompt
              |                           |
      granted        any failure    granted      any failure
         |               |             |              |
   overlay hides,   "Mic access     scored play   silent, unscored play
   device list,     denied, use
   tuning runs      Skip" (one string, no Skip button exists, the exit is Play)
```

### Desktop MIDI

The MIDI branch of the desktop Setup screen. The earlier proposal of a separate MIDI button and
`MidiSetupScreen` is replaced by the hub, so this is the state flow inside Setup when Input is MIDI.

```
Song page, Keys part:  [Setup]   [> Play]  (Play uses the saved Input, modal if not ready)
        |
        v
Setup screen, Input [MIDI v]
  HAS_MIDI? no  -> unsupported: use Chrome or Edge
            yes -> read permissions.query('midi')

   prompt              denied                 granted
     |                   |                       |
  [Request MIDI]     denied card              requestMIDIAccess (no prompt)
     |               lock-icon steps                |
  inline prompt      poll 1 s, moves on       inputs.size == 0 ?
  (nothing ends)     when granted               yes: Connect keyboard
     |                                              (Firefox: reload if lost)
  granted / denied                              no:  Press any key
                                                        |
                                                  first Note On
                                                        |
                                                  Done, [> Play]

[< Song] always leaves. Play is dark until done, then light, as in XR screen 2.
```

| Step | Desktop mic today | Desktop MIDI | XR mic |
| --- | --- | --- | --- |
| Entry | Tune, or auto on Play | Setup on the Song page | Setup on the Song page |
| Request timing | On mount | On a button press | On the Exit VR press |
| Prompt | Inline | Inline | Ends the session |
| State read | None | `permissions.query` | `permissions.query` |
| Failure copy | One string | Per state | Per state card |
| Recovery | None | Lock icon steps | Toast with Browser settings steps |
| Poll | None | 1 s | 1 s |
| Escape | Play | Play | Play |

- The desktop mic message says "use Skip" but no Skip button exists. The exit is labelled Play
  (RockyRoad-63n).
- ActiveSceneScreen requests the mic on its own for stringed parts. MIDI should not copy that, so it
  stays an explicit button inside Setup. Whether Setup keeps desktop's auto-tune on Play is open.

## Proposed options: Reposition and the input choice (2026-11-21)

Superseded 2026-11-24 by the Setup hub section below, a variant of option A that keeps Reposition. Original
framing follows. Two open questions share one answer. Keys needs a MIDI button where Reposition sits
today, and a microphone option for piano may later need a way to pick MIDI or mic. Piano and guitar
should stay close to 1:1 here, and Keys will likely gain difficulties later.

Why not a third dropdown: XR option triggers are 16.5 cm wide, so two fit in the 40 cm panel and three
do not. Narrower triggers (about 12 cm, an estimate) or a second row would change the XR design
language. Desktop's `.dropdown-row` shares width evenly and would cope.

| Option | Idea | For | Against |
| --- | --- | --- | --- |
| A. Secondary slot | Keys gets an Input setup button where guitar has Tune. Reposition moves to the Play HUD, as tuned parts already do (`as-reposition`). The mic or MIDI choice sits inside the setup screen | Closest to guitar's `[Tune] [Play]`. No new Song-page control. Bar stays at two buttons. Desktop already works this way | Keys loses Reposition on the Song page. The choice is one step deeper |
| B. Settings screen | Input type is a saved default in the XR and desktop settings | Input belongs to the player's setup, not the song, unlike Instrument and Difficulty | Hard to find. Permission requests would start from Settings |
| C. Status chip | An icon on the Song page shows the current input and its state and opens setup | Gives disconnect feedback a visible home | New control in the XR design language |
| D. Play HUD | Pick the input in the HUD | None | A permission request ends the XR session, so the choice must not happen mid-song |

- Leaning A, with B added only if a saved default is wanted and C only if disconnect feedback needs a
  home. An Input dropdown in the Difficulty slot was considered and dropped, since Keys will gain
  difficulties and XR has no room for a third trigger.
- A microphone option for piano depends on finding a polyphonic detector. The existing
  `PitchDetector` is monophonic. Until one is proven, the single MIDI button is enough, and the setup
  screen should choose its steps by input type so a mic branch can be added later.

## Setup hub (agreed 2026-11-24)

The agreed direction. The Entry point, Navigation rule, Screens and Flow sections above were rewritten to
match on 2026-11-24 and layout is provisional until the mock (RockyRoad-kqg). The "Proposed options" section
is kept as history. Where it disagrees with this section, this one wins.

### Decisions

- The Song page secondary slot becomes Setup for guitar and keys. Setup opens a new screen. Reposition
  moves onto it and keeps its old bottom-left position. Play stays bottom right and the corner button
  reads Song. The bottom bar stays at two buttons, so the three-button problem is gone with no change to
  the XR design language.
- Reposition on Setup shows only when a saved calibration exists, as on the Song page today. Reposition
  also stays in the Play HUD (`as-reposition`), which pauses the song and starts calibration.
- An Input dropdown sits near the top of Setup and the middle of the screen follows its choice.
  - Keys: None, Mic, MIDI.
  - Guitar: None, Mic. Choosing Mic is the tuning flow, and Tune is no longer a Song page button.
- The mic branch reuses the tuner's card states and copy (`MIC_CARD_TEXT`). The MIDI branch is the
  permission cards and keyboard checklist above. In the tuner the setup row already stays visible while
  the mic card shows, so the dropdown plus card layout matches existing UX.
- The requirements page is folded away. Its content becomes the first state of each card, for example
  "Needs a MIDI keyboard and USB-C cable" under the dropdown until a keyboard connects. This also removes
  the cable bullet width problem. Setup sub-states have no forward button, the card is the action.
- Play runs the saved Input and never makes a permission request, since a request at `prompt` ends the
  session.

### Play with an input that is not ready

- If Input is Mic or MIDI and its status is not ready, pressing Play opens a modal confirm card with two
  one-word buttons, Fix and Skip. Fix stays on Setup and Skip plays unscored. This is a blocking card, not
  a toast, so a user can't reach the end of a song unaware that scoring was off.
- Draft copy is a title "MIDI isn't ready" and a line "Skip scoring?". The same text works for Mic by
  swapping the name. "Skip" matches the existing "Skip tuning" wording.
- The modal appears on every Play press in that state, from Setup and from the Song page. It never appears
  when Input is None.
- Skip sets Input back to None for that play. Whether the saved choice is also cleared is open, with a
  blocked permission the likelier case for clearing it.
- Tuning not done is not "not ready". A working mic with no tuned strings keeps Mic, since tuning stays
  optional.

### Setup content

- The Mic device dropdown, level meter and Gain slider sit in a card background like the Song page
  metadata, reusing the tuner's elements. Permission and blocked cards replace the card body. The MIDI
  checklist uses the same card shape.
- Guitar with Mic selected shows the tuner's boxes below the card. Play acts as Done, so the Done button is
  gone. Restart moves to the right of the Input dropdown and shows only while the mic is ready.
- Setup uses a wrench icon based on OpenMoji 1F527 (CC BY-SA 4.0), not the settings gear. Cropping,
  variants and attribution are RockyRoad-9f2. Aurora and Grille keep a `THIRD_PARTY_NOTICES` file, and
  Grille's OpenMoji power entry is the pattern.

### The tuner's `complete` flag

- In XR the flag is unused. `XRTunerScene` passes it to `onDone`, but `showTuner` takes
  `onPlay: () => void` and ignores it (`src/xr/index.ts`). Play as Done loses nothing.
- On desktop it matters. `TunerScreen.exit()` stores `lastTuningKey` only when tuning completed, and
  `shouldAutoTune` uses it to route Play through the tuner when the part's tuning differs.
- `_finish()` shows the Bluetooth audio reminder once per page session when an external mic is active.
  Play as Done would trigger it, and that page has its own Play button and hides the setup row, so it needs
  a home on the hub. Options are a line on the mic card or the modal shape.

### Built second: HUD entry

- The Play HUD gets a Setup button beside Reposition, not replacing it. Reposition is most useful mid-song
  and the HUD bar has room for two buttons. Tapping Setup pauses the song and opens the Setup screen.
- Changing Input directly in the HUD stays rejected, since a permission request would end the session
  mid-song.
- A persistent input status indicator on the HUD doubles as the Setup entry. It covers input lost during
  a song, which the Play modal can't.
- In-session toasts are added for transient events such as a disconnect. Flat-page toasts after an exit
  stay, behind one toast API with two renderers.

### Plumbing to build for both

- A shared input model outside the screens: source, status (ready, needs permission, blocked, no device,
  lost) and the saved choice, plus the effective choice for the current play. Cards, the modal, toasts and
  the HUD indicator all read it. Today the state lives inside `XRTunerScene`.
- Sources emit status changes mid-play, built into the mic and MIDI adapters from the start.
- One question, "is the chosen input ready to start", read by both Play buttons and the modal.
- Setup takes its navigation as parameters, where Back goes and whether Play starts fresh or resumes with
  the countdown, so the Song page and the HUD call the same screen.
- Mic and MIDI access hand off into the active scene without a re-request. No live detector hand-off
  exists in XR yet (RockyRoad-0q4.5).
- The saved Input is persisted, since a permission prompt ends the session and Setup must reopen on the
  same choice after re-entry.
- Scoring pause and resume, shared with the disconnect case above.

### Open for the hub

- How the guitar tuner screen, with its Restart and Done bar, fits inside Setup's [Reposition] [Play]
  bar.
- Parts with neither input nor tuning, if any, and whether they keep Reposition on the Song page.
- Whether Reposition hides on permission and checklist sub-states.
- Whether the saved Input is cleared on "Play without".
- Source and device dropdowns opening downward over the card region on a 30 cm panel.
- Vertical fit of the guitar screen (Input row, mic card, two tuner boxes, bar). Not measured, to be
  settled while mocking.
- Mock axes: Restart as a labelled button versus Grille's compact icon button, and whether Reposition and
  Setup should join that comparison. Also whether "Input" and the mic device label read clearly together.
- Where the Bluetooth audio reminder shows once Play acts as Done.
- Desktop: whether a Setup hub keeps auto-tune on Play (`shouldAutoTune`) or replaces it.
- XR piano mic scoring is unproven on Quest, so the Mic option on piano depends on that spike.
- The desktop equivalent, expected to reuse the hub minus Reposition and the Exit VR states.

## Mic option for piano: detector candidates (2026-11-20)

Bead RockyRoad-8w1 tracks the spike ([[2026-11-21-mic-note-detection-spike]]). Polyphon was chosen and
is now built for desktop, see the generic note input section below. No maintained TS or WASM library was found that does
real-time polyphonic piano detection out of the box.

- **Polyphon** (`@markusstrasser/pitchplease` 3.1.0, MIT, TS types): AudioWorklet plus WASM SIMD,
  models `fast` and `piano` (~0.5 MB each). Self-reported piano F1 0.68 to 0.73, 40 to 50 ms onset
  latency, 12 to 20% audio-thread load on an M3 Pro. Young project and not tested on Quest.
- **Poly Peach** (`poly-peach` 0.5.1, LGPL): reports which of a given set of target notes are
  present, which suits a known chart. Last published 2023 and no accuracy data.
- **Basic Pitch** is likely too heavy for live XR. Its CQT needs chunks over 1 s and ONNX Runtime
  adds ~12 MB. This is an inference, not a measurement.
- Next step is running Polyphon `fast` and `piano` on Quest Browser and reading `stats.cpuLoad`.

## Generic note input and scoring (shipped on `feat/MIDI_IO`, RockyRoad-kvg)

Desktop Keys scores mic notes through a source-agnostic path, behind `?input=polyphon`. There are no new
screens. XR scoring, a MIDI adapter and sustain scoring are follow-ups. A MIDI keyboard would plug in as
another adapter with no change to the scorer. Results are in [[2026-11-21-polyphon-desktop-validation]].

### Design

- Types in `NoteInput.ts`: `NoteObservation` (`time` in song seconds, `midi` possibly fractional,
  `confidence`) and `NoteTarget` (`time`, integer `midi`).
- `NoteScorer` matches an observation to a target when pitch is within `tolerance` semitones and time is
  within +-150 ms. Closest in time wins, then closest pitch. Results go in `notesDetected` (0 pending,
  1 hit, -1 miss). Options are `tolerance`, `octaveFold` and `maxOctaves`.
- Guitar uses `MonoNoteAdapter` (tolerance 0.5, octave fold of one either way), the same rules as the
  retired `NoteDetector`. Polyphon and a future MIDI source use tolerance 0 with no fold.
- `NoteFramePipeline` runs frames through onsets, time mapping and the scorer. Live play and the offline
  replay (`npm run replay`) share it, so a recorded run scores the same as the live one.
- `PolyphonOnsets` emits rising edges only, gated to pitches that have a target within `gateWindow`.
  A held note re-fires when its probability rises `retriggerRise` above its lowest since onset.
  Unexpected notes cost nothing.
- `MicSource` owns the mic stream. Polyphon borrows it and the tuner is untouched.

### Time mapping

- `NoteTimeMapper` stamps each detection with `currentSecond - totalLatency * playbackRate`. Latency terms
  are real seconds, so slow playback shrinks the shift in song time. Detections are dropped while paused.
- The miss sweep runs in the same shifted time as the stamps, or late notes are swept before they match.
- Latency is a sum of detector, input, delivery and output terms in `PolyphonConfig.ts`.
  Current values are 0.11, 0.02, 0.02 and 0.03, for 0.18 s total. `pp.offset` adds real seconds for tuning.

### Validation numbers

Desktop, Polyphon `piano`, headphones, gain 1. Detail is in the validation log.

| Measure | Result |
| --- | --- |
| Mary, four takes | 94 of 104 (90.4%), bar was 90% |
| Hit window | +-150 ms, per-take median delta -96 to -5 ms |
| Latency total | 0.18 s, optional trim to 0.16 is inside the noise |
| Gate window | 0.15 s (halves extra onsets against 0.25 with the same hits) |
| Gain | No default, `pp.gain` is opt-in and was tested on Mary only |
| Chords, close low voicing | Lowest triad note about 40% (C4 to D4), 100% of played notes an octave up |

- Chord detection from the mic is an accepted gap. Wired MIDI is the chord path, which fits the MIDI flow
  above.
- Not tested: XR, a full Fur Elise pass, single C4 and D4 notes, and loopback tone calibration.
- Mic model and distance were not recorded.

## Open

- Where Reposition goes for Keys is settled by the Setup hub. Remaining hub questions are listed in
  that section.
- What a dismissed prompt reports.
- The exact option names on the Chromium MIDI setting, for the toast copy.
- Whether the MIDI requirements line should mention a powered hub or self-powered keyboard. The one
  headset crash when a bus-powered keyboard was unplugged has not recurred, so only add it if it does.
- Whether a timeout on "Press any key" should hint at keyboard settings, since some sessions logged
  no notes for an unknown reason.
- Pause and resume in XR, which the disconnect behavior depends on. No bead exists.
