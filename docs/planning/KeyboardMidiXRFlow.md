# Keyboard MIDI XR flow

Id: keyboard-midi-xr-flow
Status: Setup hub direction agreed 2026-11-24 and the XR layout settled by the mock and owner review the same day (RockyRoad-kqg, `ui/Export/XR/SetupHub/index.html`). Copy is a draft and fit is a browser estimate. A desktop flow is proposed below, not agreed. Desktop test results are in [[keyboard-midi-input]].

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
- Play on the Song page uses the saved Input and shows no modal. Input None, or Mic or MIDI not
  ready, plays unscored in XR. Desktop may route through the tuner instead, which is open.
- Play on Setup uses the saved Input too. If it is Mic or MIDI and not ready, Play opens the not-ready
  modal (screen 6).
- There is no separate requirements page. Each input's requirements are the first state of its card.
  The decisions behind all of this are in "Setup hub" below.

## Navigation rule

The corner button always reads Song and leaves to the Song page. There is no step back inside Setup, and
the guitar tuner is a modal on top of Setup, so the corner button stays Song behind it. The bottom bar holds
Reposition at bottom left, only when a saved calibration exists, and Play at bottom right. Reposition
shows on every sub-state. When it is absent a blank slot keeps Play on the right. Play is always the
light button. There is no forward button, since the cards are the actions. Re-entering after a session
exit reopens Setup on the saved Input.

## Screens

One Setup screen. The Input row is centered under the header and its middle card is centered in the space
below it. Keys offers None, Mic and MIDI. Guitar offers None and Mic. Mic is one flow for both parts
(screen 4), since the headset mic clipped non-voice audio in the guitar tests and Keys is expected to
match, but this is not verified on piano. Copy is a draft and diagrams are not to scale. The built
layout is the mock at `ui/Export/XR/SetupHub/index.html` (RockyRoad-kqg), and its fit numbers are in
"Fit estimate" below.

### 1. Input None

```
 [< Song]
       Input [None v]
     +--------------------+
     | Scoring is disabled |
     +--------------------+
 [Reposition]                 [> Play]
```

- No permission and no cards beyond the one line. Play goes straight to the song.

### 2. MIDI: requirements and keyboard checklist

Shown when MIDI is selected and permission is `granted`, and after a re-entry that follows an accepted
prompt. Markers are circles: a ring for a step in progress, a dim ring for a step not reached and a
circled check for done. The requirements line replaces the old requirements page.

```
 connect                         press a key                    done
 [< Song]                        [< Song]                       [< Song]
     Input [MIDI v]                  Input [MIDI v]                 Input [MIDI v]
 +--------------------------+    +--------------------------+   +--------------------------+
 | Needs a MIDI keyboard    |    | (/) Connect keyboard     |   | (/) Connect keyboard     |
 | and USB-C cable.         |    | ( ) Press any key        |   | (/) Press any key        |
 | ( ) Connect keyboard     |    |     Checking it sends    |   +--------------------------+
 |     Plug it in with the  |    |     notes.               |
 |     cable.               |    +--------------------------+
 | ( ) Press any key (dim)  |
 +--------------------------+
 [Reposition]    [> Play]        [Reposition]    [> Play]       [Reposition]    [> Play]
```

- Row 2 stays dim until row 1 is done. Row 1 is done when a port connects, row 2 when the first
  Note On arrives. Both are driven by `statechange` and `onmidimessage` with no re-request.
- The checklist opens at the first row that isn't done, so a user with a keyboard already attached lands
  on "Press any key". The requirements line shows only until a keyboard connects.
- The checklist stays on the done state until the user presses Play, so the success is visible.
- A keyboard that disconnects during play pauses the song and reopens Setup at "Connect keyboard" with the
  second row reset. Pause and resume is not built in XR yet and has no bead, so until then the input just
  stops responding. The HUD input indicator in "Setup hub" is the planned home for this.

### 3. Permission cards (MIDI and mic)

The mic's `warn-card` shape: a title, up to three short lines and one button. Each line fits on one line
(about 41 characters at 1.2). The card replaces the card body under the Input row.

```
 prompt                           blocked
 [< Song]                         [< Song]
     Input [MIDI v]                   Input [MIDI v]
 +----------------------------+   +----------------------------------+
 |  MIDI permission needed    |   |  MIDI blocked for this site      |
 |  The prompt shows in the   |   |  Exit VR for the fix steps.      |
 |  2D browser.               |   |  They are in the Browser app,    |
 |  [Exit VR]                 |   |  not Settings.                   |
 +----------------------------+   |  [Exit VR]                       |
 [Reposition]   [> Play]          +----------------------------------+
                                  [Reposition]   [> Play]
```

- `prompt`: Exit VR makes the `requestMIDIAccess()` call. The browser ends the session and shows the
  prompt on the flat page. The user answers, then re-enters.
- `denied`: Exit VR ends the session and the flat page shows the toast with the unblock steps below.
- The card is hidden while the state is still unknown, so the wrong text never flashes.
- The card polls the permission once a second, as `_recheckPermission` does, so a change made outside
  VR moves the screen on.
- Mic uses the same shapes with the tuner's text (`MIC_CARD_TEXT`: `prompt`, `siteBlocked`,
  `appBlocked`). The `siteBlocked` and MIDI blocked lines are the same wording.

### 4. Mic (Keys and guitar)

One flow, in this order of states.

```
 requirements                  headset mic                    ready (guitar shown)
 [< Song]                      [< Song]                       [< Song]
     Input [Mic v]                 Input [Mic v]                  Input [Mic v]
 +----------------------+      +------------------------+     +--------------------------+
 |     Needs both:      |      | Mic [Headset mic v] || |     | Mic [USB Audio Device v] ||
 |  * External mic      |      |------------------------|     | Gain ===o------------ 6x |
 |    Headset mic can't |      |  Headset mic can't     |     |         [Tune]           |
 |    hear instruments  |      |  hear instruments      |     +--------------------------+
 |  * Bluetooth audio   |      |  Plug in a USB mic,    |     [Reposition]       [> Play]
 |    External mic      |      |  then pick it in Mic.(i)|
 |    mutes the speakers|      +------------------------+
 |  Don't have both?    |      [Reposition]  [> Play]
 |  Just select Play.   |
 +----------------------+
 [Reposition]  [> Play]
```

- Requirements (first state, shown once per page session): a bullet list, not a checklist, with dot
  bullets. There is no Continue button. It clears when an external mic is detected, as the MIDI
  requirements line clears when a keyboard connects. Play is the way out for a user with neither.
  The title and bullet block are centered with the indent kept. A one-line version fits with 0.4 cm
  spare, and a two-line External mic fit as the tuner had it does not.
- Headset mic warning: a card under the device row, so the device dropdown stays and the USB mic can be
  picked. It clears when a USB mic is picked. There is no Dismiss button. The Quest steps ("Settings >
  Experimental > External Microphone, then restart headset.") sit behind an (i) on the plug-in line
  that opens a small "Mic not listed?" modal with one OK button.
- Permission states use screen 3's cards.
- Ready: the card is two rows, device with level meter and then Gain, reusing the tuner's elements.
  Guitar adds a Tune button, a normal 100 x 28 button centered at the bottom of the card. Tune opens the
  tuner modal (screen 5). Keys has no Tune button.
- Wording is "Input" for the dropdown label and "Mic" for the card. Shared copy says "instruments" instead
  of "guitar".

### 5. Tuner modal (guitar)

```
 [< Song]  (dimmed Setup behind)
   +----------------------------------------+
   |  +----------------------------------+  |
   |  |  E2         ---|---              |  |
   |  +----------------------------------+  |
   |  |  v E2   v A2   v D3  ... v E4    |  |
   |  +----------------------------------+  |
   |     [Retune]            [v Done]       |
   +----------------------------------------+
 [Reposition]                    [> Play]
```

- Opens from the Tune button. The modal is 37 wide, about 23 cm tall of the 30 cm panel, with full-size
  boxes and a Retune and Done bar. Retune is labelled.
- Done returns to Setup. Play stays on Setup, so the tuner has no Play of its own and the corner button
  stays Song. Done uses the plain `tuner-check.svg` check inverted dark, so a dark variant asset is needed.
- Tuning stays optional. A working mic with no tuned strings keeps Mic.

### 6. Not-ready modal

```
 +---------------------------+
 |  MIDI isn't ready         |
 |  Skip scoring?            |
 |  [Fix]          [Skip]    |
 +---------------------------+
```

- Shown when Play is pressed on Setup and Input is Mic or MIDI and not ready. It never shows on the Song
  page Play. Fix stays on Setup. Skip plays that run unscored and keeps the saved Input, so the modal
  returns on the next Play from Setup. That repeat is intended, since the player opened Setup each time.
  Choosing None in the dropdown is the opt-out.

### 7. Bluetooth reminder modal

- One modal, shown once per page session on the first Play with an external mic, from Setup (the tuner
  has no Play of its own). Its title is "Bluetooth Audio Reminder" with the tuner's two lines and one Play
  button. It replaces the old reminder page.

## Flow

```
Song page -- Setup --> Setup screen, Input = saved choice (default None)
                          |
        None              Mic                          MIDI
          |                |                             |
     one card        read mic permission          read MIDI permission
                  prompt  denied  granted        prompt  denied  granted
                    |       |        |             |       |        |
              permission blocked  requirements   permission blocked  requirements
              card       card     then headset   card       card     + checklist
                                  warning or
                                  mic card (ready)
          Exit VR = request  Exit VR = end   Exit VR = request  Exit VR = end
                    |       |                    |       |
              session ends, flat page       session ends, flat page
              prompt or toast               prompt or toast
                    |       |                    |       |
              user re-enters, Setup reopens on the saved Input, permission read again

Play from the Song page:
  Input None, or Mic or MIDI not ready  -> play unscored in XR
  ready                                 -> play scored

Play from Setup:
  input ready, or Input None            -> play (scored when ready)
  Mic or MIDI not ready                 -> modal: Fix (stay on Setup) or Skip (play unscored, saved Input kept)
  first Play with an external mic       -> Bluetooth reminder modal, then play

Guitar mic ready: Tune --> tuner modal over Setup --> Done --> Setup
```

Corner button on every Setup screen: Song, leaving to the Song page.

## How state reaches the user in XR

- There is no in-session toast system. The only toast is the flat-page one
  (`showMicSiteBlockedToast` in `MicPermission.ts`), which appears after an exit.
- In-session messages are cards on the panel (the tuner's `tn-mic-card` and `tn-warn`). The MIDI
  cards and checklist are the equivalent and the one place state is shown. An in-session toast system
  is planned for transient events, see "Setup hub".
- The mic's cards sit inside the tuner's `tn-boxes` region, so Setup needs a panel of its own: a header
  with the Song button, the Input row, the card, the bottom bar and a modal scrim for the not-ready,
  Bluetooth, steps and tuner modals. It hand-duplicates the card classes from `ui/tuner.uikitml`, as the
  other panels do.

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
- **Setup moved to full-panel pages.** (Superseded by the hub, where requirements are the first card state
  of screen 4.) The requirements text didn't fit as a card, so page 1 replaced the whole panel: title 2.4, bullets 1.5, grey sub-bullets 1.2, a footer line, and the Play and
  Continue buttons in the bottom bar. Its body padding was also reduced (`page-body-low`).
- **Wrong text flashed.** The card is hidden while the permission state is unknown, and the waiting
  overlay holds until the mic and input list are ready.
- **Repeats were capped.** Page 1 and the reminder show once per page session.

### Fit estimate

Measured in the mock page at 1.3 line height with a 40 x 30 cm panel, so a browser estimate and not a
uikit result. The body available under the header is 25.4 cm. Measure the built screens in the dev emulator
or headset before treating any of these as final.

| Screen | Spare height |
| --- | --- |
| Keys None, Mic ready (two rows) | 11.7 cm, 7.1 cm |
| MIDI connect, press, done | 5.0, 6.8, 8.3 cm |
| Permission cards, mic or MIDI (prompt, blocked) | 5.4, 3.5 cm |
| Mic requirements (one line each) | 0.4 cm, the tightest screen |
| Mic headset warning | 4.4 cm |
| Guitar mic ready with Tune | 3.3 cm |
| Tuner modal | 23.1 of 30 cm panel |

- The first guitar layout stacked the Input row, mic card and tuner boxes on one screen and overflowed by
  7.3 cm. Moving the tuner to its own modal fixed it. The old full-screen tuner would have fit with 3.1 cm.
- Uikit does not wrap, so the requirements line "Headset mic can't hear instruments" must stay one span.
  Its width was tight in the mock, so check it on the real panel.
- Card and tuner boxes use 2 cm side padding in the mock where the tuner uses 3.5. Neutral, settle when built.

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
match on 2026-11-24 after the mock review (RockyRoad-kqg). The "Proposed options" section is kept as
history. Where it disagrees with this section, this one wins.

### Decisions

- The Song page secondary slot becomes Setup for guitar and keys. Setup opens a new screen. Reposition
  moves onto it and keeps its old bottom-left position. Play stays bottom right and the corner button
  reads Song. The bottom bar stays at two buttons, so the three-button problem is gone with no change to
  the XR design language.
- Reposition on Setup shows only when a saved calibration exists, as on the Song page today. Reposition
  also stays in the Play HUD (`as-reposition`), which pauses the song and starts calibration.
- An Input dropdown is centered at the top of Setup and the middle card follows its choice.
  - Keys: None, Mic, MIDI.
  - Guitar: None, Mic. Tune is a button in the mic card that opens the tuner modal, and Tune is no longer
    a Song page button.
- The mic branch reuses the tuner's card states and copy (`MIC_CARD_TEXT`). The MIDI branch is the
  permission cards and keyboard checklist above. In the tuner the setup row already stays visible while
  the mic card shows, so the dropdown plus card layout matches existing UX.
- The requirements page is folded away. Its content becomes the first state of each card, for example
  "Needs a MIDI keyboard and USB-C cable" under the dropdown until a keyboard connects. This also removes
  the cable bullet width problem. Setup sub-states have no forward button, the card is the action.
- Play runs the saved Input and never makes a permission request, since a request at `prompt` ends the
  session. Play is always the light button.

### Play with an input that is not ready

- On Setup only: if Input is Mic or MIDI and its status is not ready, pressing Play opens a modal confirm
  card with two one-word buttons, Fix and Skip. Fix stays on Setup and Skip plays unscored. This is a
  blocking card, not a toast, so a user can't reach the end of a song unaware that scoring was off.
- Draft copy is a title "MIDI isn't ready" and a line "Skip scoring?". The same text works for Mic by
  swapping the name. "Skip" matches the existing "Skip tuning" wording.
- The Song page Play shows no modal and plays unscored in XR when the input is not ready. It never appears
  when Input is None.
- Skip plays that run unscored and keeps the saved Input. The modal returns on the next Play from Setup,
  which is intended because the player opened Setup each time. Choosing None is the opt-out. This also
  keeps the dropdown the only writer of the saved Input.
- Tuning not done is not "not ready". A working mic with no tuned strings keeps Mic, since tuning stays
  optional.

### Setup content

- The Mic device dropdown, level meter and Gain slider sit in a two-row card background like the Song page
  metadata, reusing the tuner's elements. Permission and blocked cards replace the card body. The MIDI
  checklist uses the same card shape.
- Guitar with Mic selected adds a Tune button to the card. Tune opens a large modal with the tuner boxes,
  a labelled Retune button and a Done button that returns to Setup. Play stays on Setup, so Done replaces
  Play as the tuner's exit and the corner button stays Song.
- Setup uses a wrench icon based on OpenMoji 1F527 (CC BY-SA 4.0), not the settings gear. Cropping,
  variants and attribution are RockyRoad-9f2. Aurora and Grille keep a `THIRD_PARTY_NOTICES` file, and
  Grille's OpenMoji power entry is the pattern.
- Step markers are circles: a ring for a step not done and a circled check for done, based on the Zest
  circled-check icon with an owner-made ring variant. The mock draws placeholders. Requirements bullets
  stay plain dots because that card is not a checklist.

### The tuner's `complete` flag

- In XR the flag is unused. `XRTunerScene` passes it to `onDone`, but `showTuner` takes
  `onPlay: () => void` and ignores it (`src/xr/index.ts`). Play as Done loses nothing.
- On desktop it matters. `TunerScreen.exit()` stores `lastTuningKey` only when tuning completed, and
  `shouldAutoTune` uses it to route Play through the tuner when the part's tuning differs.
- `_finish()` shows the Bluetooth audio reminder once per page session when an external mic is active.
  On the hub it is a modal shown once per page session on the first Play from Setup with an external mic,
  since the tuner modal has no Play. A line on the mic card was rejected because it overflowed the guitar
  screen by 2.2 cm.

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

- Parts with neither input nor tuning, if any, and whether they keep Reposition on the Song page.
- Desktop: Play from the Song page with an unready input. XR plays unscored, desktop may default to the
  tuner. Also whether a Setup hub keeps auto-tune on Play (`shouldAutoTune`) or replaces it.
- Whether the Quest mic needs an external mic for piano. The Mic flow is shared on that expectation and the
  Keys copy ("External mic" or "USB mic") is unverified.
- XR piano mic scoring is unproven on Quest, so the Mic option on piano depends on that spike.
- Measuring fit in the dev emulator or headset. The mock's numbers are a browser estimate and the
  requirements line is tight.
- A dark variant of the plain check for the tuner modal's Done button, and the final circled-check and ring
  assets.
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

- Where Reposition goes for Keys is settled by the Setup hub, and its layout by the mock. Remaining hub
  questions are listed in that section.
- What a dismissed prompt reports.
- The exact option names on the Chromium MIDI setting, for the toast copy.
- Whether the MIDI requirements line should mention a powered hub or self-powered keyboard. The one
  headset crash when a bus-powered keyboard was unplugged has not recurred, so only add it if it does.
- Whether a timeout on "Press any key" should hint at keyboard settings, since some sessions logged
  no notes for an unknown reason.
- Pause and resume in XR, which the disconnect behavior depends on. No bead exists.
