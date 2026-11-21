# Keyboard MIDI XR flow

Id: keyboard-midi-xr-flow
Status: XR screens and flow agreed 2026-11-21, copy still a draft. A desktop flow is proposed below, not agreed. Desktop test results are in [[keyboard-midi-input]].

User flow and screens for connecting a MIDI keyboard in XR, built on the Quest results in
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

- Keys songs show a keyboard icon and MIDI button on the Song page where stringed songs show Tune.
  Play never opens it on its own, and Play without MIDI stays the default.
- The requirements page shows on the first entry per page session, whatever the permission state, as
  the tuner's page 1 does.

## Navigation rule

Same as the mic flow. The corner button always reads Song and leaves to the Song page. There is no
step back inside the MIDI flow. The bottom bar holds Play (the escape, which plays without MIDI) and,
where there is a next step, a forward button. Leaving from the checklist takes one tap (Song), and
re-entering skips the requirements page until the page reloads.

## Screens

Three screens. Copy is a draft. Diagrams are not to scale.

### 1. Requirements page

The tuner's page 1 pattern, full-panel, shown once per page session.

```
 [< Song]
        Requires:
          * MIDI keyboard
          * Cable connecting keyboard to Quest USB-C
     Don't have both? Just select Play.
        [> Play]      [kb Continue]
```

- Play goes to the keys scene without MIDI (dark). Continue (light) goes to screen 2 or 3.
- Open: the cable bullet is 41 characters at the 1.5 bold bullet size and may not fit. Shorter
  options are "Keyboard-to-Quest USB-C cable" (29) or "Cable from keyboard to Quest USB-C" (34).

### 2. Permission cards

The mic's `warn-card` shape: a title, up to four short lines and one button. Each line fits on one
line (about 41 characters at 1.2).

```
 prompt                           blocked
 [< Song]                         [< Song]
    MIDI permission needed           MIDI blocked for this site
    The prompt shows in the          Exit VR for the fix steps.
    2D browser.                      Steps are in the browser, not Settings.
    [Exit VR]                        [Exit VR]
```

- `prompt`: Exit VR makes the `requestMIDIAccess()` call. The browser ends the session and shows the
  prompt on the flat page. The user answers, then re-enters.
- `denied`: Exit VR ends the session and the flat page shows the toast with the unblock steps below.
- The card is hidden while the state is still unknown, so the wrong text never flashes.
- The card polls the permission once a second, as `_recheckPermission` does, so a change made outside
  VR moves the screen on.

### 3. Keyboard checklist

A full-panel page for the keyboard steps only. Shown when permission is `granted`, and after a
re-entry that follows an accepted prompt.

```
 connect                        press a key                  done
 [< Song]                       [< Song]                     [< Song]
   Set up your keyboard           Set up your keyboard         Set up your keyboard
   * Connect keyboard             v Connect keyboard           v Connect keyboard
       Plug it in with the        * Press any key              v Press any key
       cable.                         Checking it sends notes.
   o Press any key              [> Play]                     [> Play]  (light)
 [> Play]
```

- Row 2 stays dimmed until row 1 is done. Row 1 is done when a port connects, row 2 when the first
  Note On arrives. Both are driven by `statechange` and `onmidimessage` with no re-request.
- The page opens at the first row that isn't done, so a user with a keyboard already attached lands
  on "Press any key".
- Play is dark while setup is incomplete, so a user can still skip, and light once both rows are done.
  The page stays on the done state until the user presses Play, so the success is visible.
- A keyboard that disconnects during play pauses the song and reopens this page at "Connect keyboard"
  with the second row reset. Pause and resume is not built in XR yet and has no bead, so until then
  the input just stops responding. An error symbol on the Play HUD is a lighter option. The mic flow
  doesn't handle a lost input either, so this isn't blocking.

## Flow

```
Keys Song page -- MIDI button --> requirements page --(Play)--> keys, no MIDI
                                        |
                                    (Continue)
                                        v
                               read permission state
              prompt              denied               granted
                |                   |                     |
          permission card     blocked card          keyboard checklist
         Exit VR = request    Exit VR = end          connect -> press a key
                |                   |                     |
        session ends,         session ends,           done, press Play
        browser prompt        flat page toast          (keys, MIDI on)
        on flat page          with steps
                |                   |
        user re-enters       user fixes and re-enters
                +--> back to read permission state (requirements page not repeated)
```

Corner button on every screen: Song, leaving to the Song page.

## How state reaches the user in XR

- There is no in-session toast system. The only toast is the flat-page one
  (`showMicSiteBlockedToast` in `MicPermission.ts`), which appears after an exit.
- In-session messages are cards on the panel (the tuner's `tn-mic-card` and `tn-warn`). The MIDI
  cards and checklist are the equivalent and the one place state is shown.
- The mic's cards sit inside the tuner's `tn-boxes` region, so MIDI needs a small panel of its own: a
  header with the Song button, a scrim, and the cards and pages. It hand-duplicates the card classes
  from `ui/tuner.uikitml`, as the other panels do.

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
| Requirements page | about 16 cm | about 20.8 cm |
| Permission card, worst case (title, 4 lines, button) | about 15.5 cm | about 20.8 cm |
| Keyboard checklist, two rows and one sub-line | about 11 to 12 cm | about 20.8 cm |

Page 1 is the calibration point and leaves about 1 cm. The new screens have more room, with the
checklist leaving room for a third row if one is ever wanted.

### Slot conflict on the Song page

- The Song page action bar has Reposition, Tune and Play at 15 cm each with 1 cm gaps. Three would be
  47 cm in a 38 cm bar, so only two ever show.
- Keys parts show Reposition in the secondary slot today (a saved calibration and no tuning offsets).
  A MIDI button needs that slot.
- Precedent: tuned parts already give the slot to Tune and leave Reposition to the Play HUD
  (`as-reposition` in `play.uikitml`). Keys could do the same, but where Reposition goes is open.
  Showing three buttons would mean extending the XR design language, for example narrower buttons
  (three at 12 wide plus 1 gaps is 38 cm, an estimate).
- Icon: no keyboard or MIDI icon exists. `Keys_White.svg` is the instrument icon and is stroke-only,
  so it needs an Image element, not Svg. A dedicated icon may be better.

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
cards. Keys parts have no Tune button, so the MIDI button takes that slot beside Play and desktop has no
Reposition, so two buttons fit with no slot conflict. Chrome or Edge is the tested browser (see
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

```
Song page, Keys part:  [MIDI keyboard]   [> Play]  (Play goes to the keys scene with no MIDI)
        |
        v
MidiSetupScreen (one screen with states, like the tuner's overlays)
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

[< Song] always leaves. Play is dark until done, then light, as in XR screen 3.
```

| Step | Desktop mic today | Desktop MIDI | XR mic |
| --- | --- | --- | --- |
| Entry | Tune, or auto on Play | MIDI button in Keys' Tune slot | Tune on the Song page |
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
  stays an explicit button.

## Proposed options: Reposition and the input choice (2026-11-21)

Not decided. Two open questions share one answer. Keys needs a MIDI button where Reposition sits
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

- Where Reposition goes for Keys, and whether the XR design language gains a three-button bar. See
  the proposed options above, leaning A.
- The cable bullet's width on the requirements page.
- A dedicated keyboard or MIDI icon for the Song page button.
- What a dismissed prompt reports.
- The exact option names on the Chromium MIDI setting, for the toast copy.
- Whether the requirements page should mention a powered hub or self-powered keyboard. The one
  headset crash when a bus-powered keyboard was unplugged has not recurred, so only add it if it does.
- Whether a timeout on "Press any key" should hint at keyboard settings, since some sessions logged
  no notes for an unknown reason.
- Pause and resume in XR, which the disconnect behavior depends on. No bead exists.
