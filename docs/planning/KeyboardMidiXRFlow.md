# Keyboard MIDI XR flow

Id: keyboard-midi-xr-flow
Status: screens and flow agreed 2026-11-21, copy still a draft. Desktop is out of scope for now.

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

## Open

- Where Reposition goes for Keys, and whether the XR design language gains a three-button bar.
- The cable bullet's width on the requirements page.
- A dedicated keyboard or MIDI icon for the Song page button.
- What a dismissed prompt reports.
- The exact option names on the Chromium MIDI setting, for the toast copy.
- Whether the requirements page should mention a powered hub or self-powered keyboard. The one
  headset crash when a bus-powered keyboard was unplugged has not recurred, so only add it if it does.
- Whether a timeout on "Press any key" should hint at keyboard settings, since some sessions logged
  no notes for an unknown reason.
- Pause and resume in XR, which the disconnect behavior depends on. No bead exists.
