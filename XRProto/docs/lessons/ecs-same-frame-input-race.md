---
name: ecs-same-frame-input-race
description: "Race condition when two ECS systems both read getButtonDown on the same frame — one processes input and registers panel buttons, the other immediately clicks them"
metadata: 
  node_type: memory
  type: feedback
  originSessionId: 7935a97a-5da6-407a-bf0b-0d9ffb1d32ad
---

Two ECS systems reading the same input signal on the same frame can create a race where one system's side-effect becomes the other's accidental trigger.

**Why:** CalibrationSystem and HighwaySystem both call `getButtonDown(InputComponent.Trigger)`. When the right trigger confirmed step 2 of calibration, CalibrationSystem called `showFineTunePanel()` which pushed `ft-restart` into `xrButtons`. HighwaySystem then saw the same `getButtonDown` as true, raycasted the panel, hit `ft-restart`, and clicked it — restarting the entire calibration flow in a loop.

**How to apply:** Whenever an ECS system processes input AND immediately registers interactive elements that another system could act on in the same tick, defer the registration to the next frame.

## The pattern

Instead of registering panel buttons synchronously inside a confirm handler:

```typescript
// ❌ BAD — registers ft-restart on the same frame the trigger fires
} else {
    this.state = 'done';
    this.showFineTunePanel(); // pushes ft-restart to xrButtons
    // HighwaySystem sees getButtonDown AND ft-restart in the same tick → click → loop
}
```

Use a pending flag and process it at the top of the NEXT `update()`:

```typescript
// ✅ GOOD — defers panel registration to the next frame
} else {
    this.state = 'done';
    this._pendingFineTunePanel = true; // show on next frame
}

update() {
    if (this._pendingFineTunePanel) {
        this._pendingFineTunePanel = false;
        this.showFineTunePanel();
    }
    if (this.state === 'idle' || this.state === 'done') return;
    // ... normal input processing ...
}
```

## Why `getButtonDown` is shared

IWSDK's `getButtonDown()` returns true for the entire frame the button transitions to pressed. All systems run in the same frame, so both systems see the same transition. There is no "consume input" API — the only way to avoid the race is to not expose interactive elements until the next frame.

## Scope

This applies any time a system both (a) consumes input via `getButtonDown`/`confirmDown` and (b) synchronously mutates `xrButtons` or other shared interactive state in the same `update()` call.
