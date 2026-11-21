# Keyboard MIDI XR flow

Id: keyboard-midi-xr-flow
Status: draft, 2026-11-20. Screens and copy are placeholders until screen design. Desktop is out of
scope for now.

User flow for connecting a MIDI keyboard in XR, built on the Quest results in [[keyboard-midi-input]]
and the mic flow in [[tuner-compact-layout]] (RockyRoad-0q4.5, .9, .12, .15). Permission work is
RockyRoad-lha.

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

- Keys songs show a keyboard icon and MIDI button on the pre-scene screen where stringed songs show
  Tune. Play never opens it on its own, and Play without MIDI stays the default.
- First entry per page session shows the requirements card, whatever the permission state, as the
  tuner does.

## Screens

Two screens. Copy is a draft.

**1. Requirements card** (the tuner's page 1 pattern, shown once per page session)

- Title "MIDI keys needs:" with a MIDI keyboard and a USB-C cable from it to the Quest.
- Footer "Don't have both? Just select Play."
- Buttons: Play (skips MIDI) and Continue.

**2. Setup checklist** (one screen, three rows, each row pending, active, done or blocked)

| Row | Active when | Shows while active | Done when |
| --- | --- | --- | --- |
| 1 Allow MIDI access | Always first | `prompt`: "The prompt shows in the 2D browser." with an Exit VR button that makes the request. `denied`: "Blocked for this site. Exit VR for the fix steps." with an Exit VR button that ends the session. | State is `granted` |
| 2 Connect your keyboard | Row 1 done and `inputs` is empty | "Plug it into the Quest with the USB-C cable." | A port connects |
| 3 Press any key | Row 2 done | "Checking the keyboard sends notes." | First Note On |

- Rows 2 and 3 stay dimmed until the row above is done. That fits the tests, since the page can't see
  devices before access is granted.
- The screen closes by itself once row 3 is done. It opens at the first row that isn't done, so a
  returning user with permission already granted and a keyboard attached lands on row 3 and a first
  key press is the only step.
- Row 1 needs a state read on entry. `granted` calls `requestMIDIAccess()` to get the port list.
  Unavailable (no Web MIDI) needs its own message. Not seen on Quest.
- The checklist polls the permission once a second, as `_recheckPermission` does, so a change made
  outside VR moves row 1 on.
- A keyboard that disconnects during play pauses the song and reopens this screen with row 2 active
  and row 3 reset. Pause and resume is not built in XR yet and has no bead, so this depends on it.
  Until then the input just stops responding. An error symbol on the play screen is a lighter option.
  The mic flow doesn't handle a lost input either, so this isn't blocking.

## Flow

```
Keys pre-scene -- MIDI button --> requirements card --(Play)--> keys, no MIDI
                                        |
                                    (Continue)
                                        v
                                 setup checklist
   row 1 prompt: Exit VR = request ---> session ends, browser prompt on flat page,
                                        user re-enters, row 1 done
   row 1 denied: Exit VR = end --------> session ends, page toast with steps,
                                        user re-enters after fixing
   row 2: port connects ---> row 3: Note On ---> screen closes, keys play
                                  ^
   port disconnects in play: pause, reopen at row 2
```

## How state reaches the user in XR

- There is no in-session toast system. The only toast is the page toast
  (`showMicSiteBlockedToast` in `MicPermission.ts`), which appears on the flat page after an exit.
- In-session messages are cards on the panel (the tuner's `tn-mic-card` and `tn-warn`). The checklist
  is MIDI's equivalent, and it is the one place state is shown.
- Outside the checklist, a dead keyboard can just keep failing to respond until the user opens the
  MIDI button again. A pause on disconnect is the exception because it needs no new UI beyond
  reopening the checklist.

## Unblock steps for the blocked toast

Not in the Horizon OS browser settings. They go through Chromium's own settings page:

1. In a new tab, open `chrome://settings`, then Site Settings > All Sites.
2. Find the site and set "MIDI device control & reprogram".
3. That page renders on top of the browser tabs, so the way back is the back button at the top left.

A page can't open it. Links to `chrome://settings` and its MIDI deep link did nothing and
`window.open` returned `null`, so the toast shows these steps as text only.

Draft toast text needs the back-button note, since the user can get stuck. The mic's steps are
different (Browser app settings > Privacy and Security > Website Permissions > Microphone).

## Differences from the mic flow

- No `appBlocked`. No OS-level toggle for MIDI has been found, and a granted request returned in
  2 ms every time. If one exists, its signature would be state `granted` with a request that never
  settles.
- Rows 2 and 3 and the disconnect pause have no mic counterpart.
- The mic's `prompt` path has no page toast after the exit, so a dismissed prompt leaves the user on
  the flat page with no hint. Reusing the `siteBlocked` toast for MIDI's prompt path is worth
  considering for both.
- `MIC_CARD_TEXT`, the mic-named toast and `MicPermission.ts` need the permission type as a
  parameter, or a MIDI twin.

## Open

- Whether the blocked toast can say less. The steps are long and awkward, see below.
- What a dismissed prompt reports.
- Whether the requirements card should mention a powered hub or self-powered keyboard. The one
  headset crash when a bus-powered keyboard was unplugged has not recurred, so only add it if it does.
- Whether a timeout on row 3 should hint at keyboard settings, since some sessions logged no notes
  for an unknown reason.
- Whether three rows fit one XR panel at once. Revisit at screen design. If not, the fallback is one
  warn-card per step (permission, connect, press a key), which fits the existing component.
- The row layout in uikitml. The tuner's warn-card has a title, four lines and one button, so a
  checklist needs a new component. Page 1 already uses open-circle bullets.
