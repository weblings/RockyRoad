# ChartPlayerGame.cs — Conversion Analysis

**Source:** `ChartPlayerShared/ChartPlayerGame.cs`
**Inherits from:** `MonoGameLayout` (a UI layout framework layered on top of MonoGame)
**Role:** Application shell — singleton that owns the game loop, asset loading, input, active Scene3D, and root UI element

---

## What the class does

This is the top-level entry point for the application. It is not a domain class — it is framework glue. Responsibilities:
- Initializes assets (images, fonts) via `SetHost`
- Registers all input mappings (keyboard + drum MIDI)
- Creates the root UI element (`SongPlayerInterface`)
- Runs the per-frame `Update` (logic) and `Draw` (rendering) lifecycle
- Owns a reference to the active `Scene3D` and a `ChartPlayerPlugin` handle

---

## This class does not port 1:1

`ChartPlayerGame` is a MonoGame framework integration point. In Three.js, its responsibilities are distributed across browser primitives. The equivalent is an `App` class that wires these together manually.

---

## Subsystem mapping

### Game loop
| MonoGame | Browser |
|---|---|
| `MonoGameLayout` base class drives `Update` / `Draw` | `requestAnimationFrame` loop |
| `Update(float secondsElapsed)` | `update(dt: number)` — `dt` computed from `performance.now()` delta |
| `Draw()` | `render()` — calls `renderer.render(scene, camera)` |
| Fixed-interval host loop | `requestAnimationFrame` (variable, tied to display refresh) |

### Viewport / resize
```cs
// Called every frame in Draw():
Scene3D.Camera.ViewportWidth  = (int)Layout.Current.Bounds.Width;
Scene3D.Camera.ViewportHeight = (int)Layout.Current.Bounds.Height;
```
MonoGame polls viewport size at draw time. Replace with a reactive pattern:
```ts
new ResizeObserver(() => {
  renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  camera.setViewport(canvas.clientWidth, canvas.clientHeight);
}).observe(canvas);
```

### Asset loading (`SetHost`)
| MonoGame | Browser |
|---|---|
| `MonoGameContentLoader` + `LoadImageManifest("ImageManifest.xml")` | `fetch` / `THREE.TextureLoader` / `THREE.LoadingManager` |
| `GetImage("SingleWhitePixel")` | `THREE.Texture` created from a 1×1 white pixel |
| `GetFont("MainFont")` | CSS font loaded via `@font-face` or a bitmap font atlas |
| Synchronous, blocking | Async — `init()` should be `async`, assets awaited before first render |

### Input
| MonoGame | Browser |
|---|---|
| `InputManager.AddMapping("Exit", new KeyMapping(InputKey.Escape))` | `keydown` event listener |
| `KeyMapping` with modifiers | Check `event.key` + `event.shiftKey` / `event.altKey` etc. |
| `DrumUIMapping` (MIDI drum triggers) | Web MIDI API (`navigator.requestMIDIAccess()`) |
| `InputManager.WasClicked(name, this)` | Custom `InputManager` class tracking pressed/released state per named action |

### Fullscreen
```cs
Plugin.ToggleFullScreen();  // DAW plugin host toggles window
```
No plugin in the browser. Replace with:
```ts
document.documentElement.requestFullscreen();  // or exitFullscreen()
```

### Plugin
`ChartPlayerPlugin` is a DAW plugin wrapper (VST/AU host integration). It has **no browser equivalent** and is dropped entirely. Any plugin-specific functionality (fullscreen, window management) is replaced by browser APIs.

### UI
| MonoGame | Browser |
|---|---|
| `RootUIElement = new SongPlayerInterface()` | HTML/CSS overlay `<div>` sitting on top of the `<canvas>` |
| `MonoGameLayout` draws UI via SpriteBatch | Standard DOM rendering |
| Draw order: Scene3D first, then UI on top | `renderer.render(scene, camera)` first; HTML layer on top via `position: absolute` |

### Color constants
```cs
UIColor PanelBackgroundColor        = new UIColor(50, 55, 65);
UIColor PanelBackgroundColorDark    = PanelBackgroundColor * 0.8f;
UIColor PanelBackgroundColorDarkest = PanelBackgroundColor * 0.5f;
UIColor PanelForegroundColor        = UIColor.Lerp(PanelBackgroundColor, UIColor.White, 0.75f);
```
Port as CSS custom properties or `THREE.Color` constants. The arithmetic (scalar multiply, lerp) maps directly to `THREE.Color.multiplyScalar()` and `THREE.Color.lerp()`.

---

## Proposed TS structure

`ChartPlayerGame` becomes an `App` class:

```
App
├── renderer: THREE.WebGLRenderer
├── scene: THREE.Scene
├── activeScene3D: Scene3D | null
├── inputManager: InputManager
├── init(): Promise<void>       // asset loading, event setup
├── update(dt: number): void    // game logic
└── render(): void              // renderer.render(scene, camera)
```

The `requestAnimationFrame` loop calls `update` then `render` each tick, computing `dt` from `performance.now()`.

---

## No output file yet
This class is converted last — it depends on Scene3D, SongPlayerInterface, and InputManager all being defined first.
