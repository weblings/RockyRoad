# Third-party notices

RockyRoad ships the icon artwork below in `public/`. Each such icon file carries an origin comment.

## Vidstack media-icons 0.10.0 (MIT)

Source: <https://github.com/vidstack/media-icons> (npm `media-icons`). Used for: `back-arrow.svg` (arrow-left), `chevron-down.svg`, `chevron-up.svg`, `pause-icon.svg` (pause), `play-icon.svg` and `play-icon-white.svg` (play), `recal-icon.svg` (repeat-on), `replay.svg` and `tuner-restart.svg` (replay), `settings-gear-icon.svg` (settings), `tune-icon.svg` and `tune-icon-dark.svg` (odometer), and `check.svg` and `tuner-check.svg` (check, taken from the GitHub repo at commit 9c1fafb because the npm 0.10.0 package does not include it). The check path is also inlined in `src/desktop/TunerScreen.ts`.

Changes: path data is unchanged. Size and fill colour were set per use.

```
MIT License

Copyright (c) 2023 Rahim Alwer

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## OpenMoji (CC BY-SA 4.0)

Copyright HfG Schwaebisch Gmuend and the OpenMoji contributors. Licensed under CC BY-SA 4.0: <https://creativecommons.org/licenses/by-sa/4.0/>. Sources and uses:

- <https://openmoji.org/library/emoji-1F527/> (wrench, U+1F527): `setup-icon.svg`.
- <https://openmoji.org/library/emoji-1F3B8/> (guitar, U+1F3B8): `Guitar_White.svg` and `Bass_White.svg`.
- <https://openmoji.org/library/emoji-1F3B9/> (musical keyboard, U+1F3B9): `Keys_White.svg`.
- <https://openmoji.org/library/emoji-1FA78/> (drop of blood, U+1FA78), <https://openmoji.org/library/emoji-1F3B5/> (musical note, U+1F3B5) and <https://openmoji.org/library/emoji-1F36A/> (cookie, U+1F36A): merged into `RockyRoad_Temp.svg`, the app favicon.

Changes: the owner altered each emoji in Inkscape, merged three of them for the favicon, and cropped the wrench from an A4 page to a square viewBox. The adapted icons listed above are shared under the same licence. The rest of RockyRoad keeps its own licence (see `LICENSE`).
