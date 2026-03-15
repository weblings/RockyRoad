import * as THREE from "three";
import { ChartScene3D, getStartNote } from "./ChartScene3D";
import { FretCamera, getFretPosition } from "./FretCamera";
import { getImage } from "./UIImage";
import type { UIImage } from "./UIImage";
import { makeColor, lerp as lerpColor } from "./UIColor";
import type { UIColor } from "./UIColor";
import { lerp, clamp } from "./MathUtil";
import type { SongStructure, SongInstrumentNotes, SongInstrumentPart, SongNote, CentsOffset } from "./SongFormat";
import { ESongNoteTechnique } from "./SongFormat";
type TechFlag = typeof ESongNoteTechnique[keyof typeof ESongNoteTechnique];

// ─── Constants ────────────────────────────────────────────────────────────────

const NUM_FRETS = 24;

// 7 colors cycling for string assignment (offset=1 for standard guitar/bass)
const STRING_COLORS: UIColor[] = [
    makeColor(0.1, 0.8, 0),        // Green
    makeColor(1, 0, 0),            // Red
    makeColor(1, 1, 0),            // Yellow
    makeColor(0, 0.6, 1),          // Cyan
    makeColor(1, 0.647, 0),        // Orange
    makeColor(0.1, 0.8, 0),        // Green (second)
    makeColor(0.8, 0, 0.8),        // Purple
];
const STRING_COLOR_NAMES = ["Green", "Red", "Yellow", "Cyan", "Orange", "Green", "Purple"];

// Shared white-half-alpha constant — used heavily for fret lines and shadows
const WHITE_HALF = makeColor(1, 1, 1, 0.5);

// Off-white for text labels — slightly softer than pure white (#E8E8E8)
const LABEL_WHITE: UIColor = { r: 232 / 255, g: 232 / 255, b: 232 / 255, a: 1 };

// ─── Technique helpers ────────────────────────────────────────────────────────

// Build name→value lookup once from the ESongNoteTechnique const object
const TECH_BY_NAME: Record<string, number> = {};
for (const [k, v] of Object.entries(ESongNoteTechnique)) TECH_BY_NAME[k] = v;

// Normalize a note's Techniques field from the JSON.
// The JSON serializes technique flags as a string name (e.g. "Slide") or a
// comma-separated list ("HammerOn, Chord"). Convert to a numeric bitmask so
// bitwise tests work correctly at render time.
function normalizeTechniques(notes: SongNote[]): void {
    for (const note of notes) {
        const t = (note as any).Techniques;
        if (typeof t === 'string') {
            let mask = 0;
            for (const part of t.split(',')) mask |= TECH_BY_NAME[part.trim()] ?? 0;
            (note as any).Techniques = mask;
        }
    }
}

function hasTech(note: SongNote, tech: TechFlag): boolean {
    return ((note.Techniques ?? 0) & tech) !== 0;
}

// ─── FretPlayerScene3D ────────────────────────────────────────────────────────

export class FretPlayerScene3D extends ChartScene3D {
    private readonly fretCamera: FretCamera;
    private readonly instrumentNotes: SongInstrumentNotes;
    private readonly numStrings: number;
    private readonly stringNoteImages: UIImage[];
    private readonly stringNoteTrailImages: UIImage[];

    // Pre-pass maps: TimeOffset → true when chord/note display should refresh
    private readonly nonRepeatChords: Set<number>;
    private readonly nonRepeatNotes:  Set<number>;

    // When true (default): all fret-number labels are solid white with a dark stroke.
    // When false: C#-faithful dim/bright logic applies (bright in hand range, 25% alpha outside).
    boldText = true;

    // When true: string order is flipped vertically (low strings on top, high strings on bottom).
    invertStrings = false;

    // Frame state — reset each DrawQuads call
    private minFret = 0;
    private maxFret = 4;
    private targetFocusFret = 2;
    private firstNote: SongNote | null = null;
    private startNotePosition = 0;

    // Note detection state — one slot per note in the sorted array.
    // 0 = pending, 1 = hit, -1 = missed.
    // mockDetection drives a cycling 2-hit/1-miss pattern for testing.
    private readonly noteIndexMap: Map<SongNote, number>;
    private readonly notesDetected: Int8Array;
    mockDetection = false;
    private mockEvalPos  = 0;
    private mockCycleCount = 0;

    // "Currently playing" note tracking
    private currentChordNote:  SongNote | null = null;
    private currentFingerNote: SongNote | null = null;
    private readonly currentStringNotes: (SongNote | null)[];

    constructor(
        renderer: THREE.WebGLRenderer,
        texture: THREE.Texture,
        songStructure: SongStructure,
        instrumentNotes: SongInstrumentNotes,
        instrumentPart: SongInstrumentPart,
    ) {
        const size = renderer.getSize(new THREE.Vector2());
        const fretCamera = new FretCamera(size.x, size.y);
        super(renderer, fretCamera, texture, songStructure);

        this.fretCamera = fretCamera;
        this.instrumentNotes = instrumentNotes;

        this.numStrings = instrumentPart.InstrumentType === "BassGuitar" ? 4 : 6;

        // Highway X span — used by inherited drawBeats()
        this.highwayStartX = getFretPosition(0);
        this.highwayEndX   = getFretPosition(NUM_FRETS);

        this.currentStringNotes = new Array(this.numStrings).fill(null);

        // stringColorOffset=1 for standard guitar/bass
        // (low-tuned bass offset=0 logic skipped for Phase 5)
        const colorOffset = 1;

        this.stringNoteImages = [];
        this.stringNoteTrailImages = [];
        for (let s = 0; s < 6; s++) {
            const name = STRING_COLOR_NAMES[s + colorOffset];
            this.stringNoteImages[s]      = getImage(`Guitar${name}`);
            this.stringNoteTrailImages[s] = getImage(`NoteTrail${name}`);
        }

        // Convert string technique names → numeric bitmask (JSON serializes enum as string)
        normalizeTechniques(instrumentNotes.Notes);

        // Sort notes: ascending TimeOffset, then descending String (so higher strings draw later = on top)
        instrumentNotes.Notes.sort((a, b) => {
            if (a.TimeOffset !== b.TimeOffset) return a.TimeOffset - b.TimeOffset;
            return (b.String ?? 0) - (a.String ?? 0);
        });

        // Build nonRepeat maps with one pass over the sorted notes
        this.nonRepeatChords = new Set<number>();
        this.nonRepeatNotes  = new Set<number>();
        this.buildNonRepeatMaps();

        // Detection state — allocated after sort so indices are stable
        this.noteIndexMap  = new Map(instrumentNotes.Notes.map((n, i) => [n, i]));
        this.notesDetected = new Int8Array(instrumentNotes.Notes.length); // 0-filled
    }

    // Resets mock detection state — call when seeking or toggling mockDetection.
    resetMockDetection(): void {
        this.notesDetected.fill(0);
        this.mockEvalPos    = 0;
        this.mockCycleCount = 0;
    }

    // ─── Camera update ────────────────────────────────────────────────────────

    protected override updateCamera(dt: number): void {
        this.fretCamera.update(
            this.minFret,
            this.maxFret,
            this.targetFocusFret,
            -(this.currentTime * this.timeScale),
            dt,
        );
    }

    // ─── Mock detection ───────────────────────────────────────────────────────

    // Advances the detection scan to mark any notes that have just crossed the
    // now-line. Cycles 2 hits then 1 miss. Safe to call every frame.
    private evaluateMockDetection(): void {
        if (!this.mockDetection) return;
        const notes = this.instrumentNotes.Notes;
        // Small tolerance so the mark happens just after the note passes
        const evalTime = this.currentTime - 0.05;
        while (this.mockEvalPos < notes.length && notes[this.mockEvalPos].TimeOffset <= evalTime) {
            if (this.notesDetected[this.mockEvalPos] === 0) {
                this.notesDetected[this.mockEvalPos] = this.mockCycleCount % 3 === 2 ? -1 : 1;
                this.mockCycleCount++;
            }
            this.mockEvalPos++;
        }
    }

    // ─── Main draw ────────────────────────────────────────────────────────────

    protected override drawQuads(dt: number): void {
        this.evaluateMockDetection();
        super.drawQuads(dt); // → ChartScene3D.drawBeats()

        // Fog — push notes into the distance
        this.fogEnabled = true;
        this.fogStart   = 400;
        this.fogEnd     = this.fretCamera.cameraDistance + this.fretCamera.focusDist;
        this.fogColor   = { r: 0, g: 0, b: 0, a: 1 };

        const notes = this.instrumentNotes.Notes;

        // ── 1. Fret timeline background strips (one per fret) ─────────────────
        for (let fret = 0; fret < NUM_FRETS; fret++) {
            this.drawFretTimeLine(fret, 0, this.startTime, this.endTime, WHITE_HALF);
        }

        // ── 2. Reset fret tracking for camera ────────────────────────────────
        this.minFret = NUM_FRETS;
        this.maxFret = 0;
        this.firstNote = null;

        // ── 3. Advance note window ────────────────────────────────────────────
        const secsBehind = 1;
        this.startNotePosition = getStartNote(
            this.currentTime - secsBehind,
            secsBehind,
            this.startNotePosition,
            notes,
        );

        // ── 4. Hand position areas (forward pass) ─────────────────────────────
        const handPosColor = makeColor(1, 1, 1, 32 / 255);
        const singleWhitePixel = getImage("SingleWhitePixel");

        let lastHandFret = -1;
        let lastHandTime = this.currentTime;
        let pos = this.startNotePosition;

        for (; pos < notes.length; pos++) {
            const note = notes[pos];
            if (note.TimeOffset > this.endTime) break;

            if (note.TimeOffset > this.currentTime && lastHandFret !== -1 && lastHandFret !== note.HandFret) {
                this.drawFlatImageFull(singleWhitePixel, lastHandFret - 1, lastHandFret + 3, lastHandTime, note.TimeOffset, 0, handPosColor);
                lastHandTime = note.TimeOffset;
            }
            lastHandFret = note.HandFret;
        }
        if (lastHandFret !== -1) {
            this.drawFlatImageFull(singleWhitePixel, lastHandFret - 1, lastHandFret + 3, lastHandTime, this.endTime, 0, handPosColor);
        }

        // ── 5. Find "current" notes for overlay ───────────────────────────────
        for (let s = 0; s < this.numStrings; s++) this.currentStringNotes[s] = null;
        this.currentChordNote  = null;
        this.currentFingerNote = null;

        let lastNoteIdx = pos;
        if (lastNoteIdx >= notes.length) lastNoteIdx = notes.length - 1;

        for (let p = lastNoteIdx; p >= this.startNotePosition; p--) {
            const note = notes[p];
            if (note.TimeOffset > this.currentTime) continue;

            if (hasTech(note, ESongNoteTechnique.Chord)) {
                if (this.currentChordNote === null) this.currentChordNote = note;
            } else {
                const str = note.String;
                if (str >= 0 && str < this.numStrings && this.currentStringNotes[str] === null) {
                    if (note.TimeOffset + Math.max(note.TimeLength, 0.2) > this.currentTime) {
                        this.currentStringNotes[str] = note;
                    }
                }
            }

            if (this.currentFingerNote === null && (note.FingerID ?? -1) !== -1) {
                this.currentFingerNote = note;
            }
        }

        // ── 6. Draw all notes (backward — furthest ahead renders first = under) ─
        for (let p = lastNoteIdx; p >= this.startNotePosition; p--) {
            const note = notes[p];
            if (note.TimeOffset > this.endTime) continue;
            this.drawNote(note);
        }

        // ── 7. String lines at the "now" face ─────────────────────────────────
        for (let str = 0; str < this.numStrings; str++) {
            const strColor = { ...this.getStringColor(str), a: 192 / 255 };
            this.drawFretHorizontalLine(0, NUM_FRETS, this.startTime, this.getStringHeight(this.getStringOffset(str)), strColor, 0.04);
        }

        // ── 8. Fret vertical lines + fret number labels at the "now" face ────
        for (let fret = 1; fret < NUM_FRETS; fret++) {
            this.drawFretVerticalLine(fret - 1, this.startTime, this.getStringHeight(0), this.getStringHeight(this.numStrings - 1), WHITE_HALF, 0.03);
        }
        // Cast breaks CFA narrowing: TSC narrows firstNote to null after the
        // explicit reset at step 2, unaware that drawSingleNote reassigns it.
        const handBase = (this.firstNote as SongNote | null)?.HandFret ?? -1;
        for (let fret = 1; fret <= NUM_FRETS; fret++) {
            const inHandRange = handBase >= 0 && fret >= handBase && fret < handBase + 4;
            const labelColor: UIColor = this.boldText || inHandRange
                ? LABEL_WHITE
                : { r: 1, g: 1, b: 1, a: 64 / 255 };
            this.drawVerticalText(fret.toString(), fret - 0.5, 0, this.currentTime, labelColor, 0.08);
        }

        // ── 9. Current chord / finger overlays ────────────────────────────────
        if (this.currentChordNote !== null) {
            this.drawChordOutline(this.currentChordNote, true);
            if (!hasTech(this.currentChordNote, ESongNoteTechnique.ChordNote)) {
                const chord = this.getChord(this.currentChordNote.ChordID);
                if (chord) this.drawChordNotesFull(this.currentChordNote, chord, true, false);
            }
        }

        for (let str = 0; str < this.numStrings; str++) {
            const sn = this.currentStringNotes[str];
            if (sn) this.drawSingleNote(sn, true, false);
        }

        if (this.firstNote !== null) {
            this.targetFocusFret = this.firstNote!.HandFret + 1;
        }
    }

    // ─── Note draw dispatch ───────────────────────────────────────────────────

    private drawNote(note: SongNote): void {
        if (hasTech(note, ESongNoteTechnique.Chord)) {
            if (!hasTech(note, ESongNoteTechnique.ChordNote)) {
                const chord = this.getChord(note.ChordID);
                if (chord) this.drawChordNotesFull(note, chord, false, false);
            }
            if (note.TimeOffset > this.currentTime) {
                this.drawChordOutline(note, false);
            }
        } else {
            if (note.TimeOffset > this.currentTime && note.Fret > 0 && this.nonRepeatNotes.has(note.TimeOffset)) {
                this.drawVerticalText(note.Fret.toString(), note.Fret - 0.5, 0, note.TimeOffset, LABEL_WHITE, 0.12);
            }
            this.drawSingleNote(note, false, false);
        }

        // Finger chord overlay for non-current notes
        const fingerID = note.FingerID ?? -1;
        if (fingerID !== -1 && note.TimeOffset > this.currentTime) {
            if (this.nonRepeatChords.has(note.TimeOffset)) {
                const fingerChord = this.getChord(fingerID);
                if (fingerChord) {
                    this.drawChordNotesFull(note, fingerChord, false, true);
                    this.drawChordOutline(note, false);
                }
            }
        }
    }

    // ─── Single note ──────────────────────────────────────────────────────────

    private drawSingleNote(note: SongNote, drawCurrent: boolean, isGhost: boolean): void {
        const isCurrent  = note.TimeOffset <= this.currentTime;
        const noteIdx    = this.noteIndexMap.get(note) ?? -1;
        const isDetected = noteIdx >= 0 && this.notesDetected[noteIdx] === 1;

        // Dim undetected notes; leave detected notes at full string color
        let stringColor: UIColor;
        if (isDetected) {
            stringColor = { ...this.getStringColor(note.String), a: 1 };
        } else {
            const dimAmount = 0.25;
            stringColor = lerpColor(lerpColor({ r: 1, g: 1, b: 1, a: 1 }, this.getStringColor(note.String), dimAmount), { r: 0, g: 0, b: 0, a: 1 }, dimAmount);
        }

        if (isGhost) stringColor = { ...stringColor, a: 32 / 255 };

        if (hasTech(note, ESongNoteTechnique.Accent)) {
            stringColor = lerpColor(stringColor, { r: 1, g: 1, b: 1, a: stringColor.a }, 0.75);
        }

        const noteHeadTime = Math.max(note.TimeOffset, this.currentTime);
        let noteSustain = note.TimeLength - (noteHeadTime - note.TimeOffset);
        if (noteSustain < 0) noteSustain = 0;

        // Technique flags
        const isMuted   = hasTech(note, ESongNoteTechnique.FretHandMute) || hasTech(note, ESongNoteTechnique.PalmMute);
        const isSlide   = hasTech(note, ESongNoteTechnique.Slide);
        const isVibrato = hasTech(note, ESongNoteTechnique.Vibrato);
        const isBend    = hasTech(note, ESongNoteTechnique.Bend) && (note.CentsOffsets?.length ?? 0) > 0;

        // Modifier image (overlaid on note head)
        let modifierImage: UIImage | null = null;
        if      (hasTech(note, ESongNoteTechnique.HammerOn))     modifierImage = getImage("NoteHammerOn");
        else if (hasTech(note, ESongNoteTechnique.PullOff))      modifierImage = getImage("NotePullOff");
        else if (hasTech(note, ESongNoteTechnique.FretHandMute)) modifierImage = getImage("NoteMute");
        else if (hasTech(note, ESongNoteTechnique.PalmMute))     modifierImage = getImage("NotePalmMute");
        else if (hasTech(note, ESongNoteTechnique.Harmonic))     modifierImage = getImage("NoteHarmonic");
        else if (hasTech(note, ESongNoteTechnique.PinchHarmonic)) modifierImage = getImage("NotePinchHarmonic");

        if (isMuted) stringColor = lerpColor(stringColor, { r: 0, g: 0, b: 0, a: stringColor.a }, 0.5);

        const stringOffset = this.getStringOffset(note.String);
        let drawFret = note.Fret;

        if (note.Fret === 0) {
            // ── Open string ──────────────────────────────────────────────────
            drawFret = note.HandFret + 1.5;

            if (!(drawCurrent && isCurrent) && note.TimeOffset + note.TimeLength > this.currentTime) {
                this.minFret = Math.min(this.minFret, note.HandFret);
                this.maxFret = Math.max(this.maxFret, note.HandFret + 3);

                this.drawFlatImage(this.stringNoteTrailImages[note.String], drawFret - 0.5, noteHeadTime, noteHeadTime + noteSustain, this.getStringHeight(stringOffset), stringColor, 0.05);
            }

            if (!isCurrent || drawCurrent) {
                this.drawVerticalImage(this.stringNoteImages[note.String], note.HandFret - 1, note.HandFret + 3, noteHeadTime, this.getStringHeight(stringOffset), stringColor, 0.04);
            }
        } else {
            // ── Fretted note ─────────────────────────────────────────────────
            if (isSlide && isCurrent) {
                drawFret = this.getSlideFret(note, this.currentTime);
            }

            if (!(drawCurrent && isCurrent) && note.TimeOffset + note.TimeLength > this.currentTime) {
                this.minFret = Math.min(this.minFret, drawFret);
                this.maxFret = Math.max(this.maxFret, drawFret);

                // Sustain trail
                if (isSlide) {
                    const slideTo = note.SlideFret ?? drawFret;
                    this.drawImageTrail(
                        this.stringNoteTrailImages[note.String], stringColor, 0.03,
                        new THREE.Vector3(drawFret - 0.5, this.getStringHeight(stringOffset), noteHeadTime),
                        new THREE.Vector3(slideTo - 0.5,  this.getStringHeight(stringOffset), noteHeadTime + noteSustain),
                    );
                } else if (isBend) {
                    this.drawBend(this.stringNoteTrailImages[note.String], note.Fret - 0.5, note.TimeOffset, note.TimeLength, stringOffset, note.CentsOffsets!, stringColor);
                } else if (isVibrato) {
                    this.drawVibrato(this.stringNoteTrailImages[note.String], note.Fret - 0.5, note.TimeOffset, note.TimeOffset + note.TimeLength, this.getStringHeight(stringOffset), stringColor);
                } else {
                    this.drawFlatImage(this.stringNoteTrailImages[note.String], note.Fret - 0.5, noteHeadTime, noteHeadTime + noteSustain, this.getStringHeight(stringOffset), stringColor, 0.03);
                }
            }

            if (!isCurrent || drawCurrent) {
                const noteHeadHeight = this.getNoteHeadHeight(note);
                if (!hasTech(note, ESongNoteTechnique.Continued) || isCurrent) {
                    if (isDetected) this.drawVerticalImageCentered(getImage("GuitarDetected"), drawFret - 0.5, noteHeadTime, noteHeadHeight, stringColor, 0.1);
                    this.drawVerticalImageCentered(this.stringNoteImages[note.String], drawFret - 0.5, noteHeadTime, noteHeadHeight, stringColor, 0.08);
                }
            }
        }

        if (!isCurrent || drawCurrent) {
            if (modifierImage !== null) {
                this.drawVerticalImageCentered(modifierImage, drawFret - 0.5, noteHeadTime, this.getStringHeight(stringOffset), { r: 1, g: 1, b: 1, a: 1 }, 0.08);
            }
        }

        if (!isCurrent) {
            // Shadow on fretboard
            this.drawFretHorizontalLine(drawFret - 1, drawFret, noteHeadTime, 0, WHITE_HALF, 0.08);

            // Small marker on lower strings
            for (let prevStr = 0; prevStr < stringOffset; prevStr++) {
                this.drawFretHorizontalLine(drawFret - 0.6, drawFret - 0.4, noteHeadTime, this.getStringHeight(prevStr), WHITE_HALF, 0.04);
            }
        }

        // Vertical connector line from fretboard up to note head
        this.drawFretVerticalLine(drawFret - 0.5, noteHeadTime, 0, this.getStringHeight(stringOffset), WHITE_HALF, 0.03);

        if (note.TimeOffset > this.currentTime) this.firstNote = note;
    }

    // ─── Chord notes ──────────────────────────────────────────────────────────

    private drawChordNotesFull(
        note: SongNote,
        chord: { Fingers: number[]; Frets: number[] },
        drawCurrent: boolean,
        isGhost: boolean,
    ): void {
        for (let str = 0; str < chord.Fingers.length; str++) {
            if (chord.Fingers[str] === -1 && chord.Frets[str] === -1) continue;
            if (chord.Frets[str] >= NUM_FRETS) continue;

            const chordNote: SongNote = {
                TimeOffset: note.TimeOffset,
                TimeLength: note.TimeLength,
                EndTime: note.EndTime,
                Fret:      chord.Frets[str],
                String:    str,
                HandFret:  note.HandFret,
                ChordID:   note.ChordID,
                Techniques: note.Techniques,
            };

            let drawFret = chordNote.Fret;
            if ((chordNote.SlideFret ?? -1) !== -1) {
                drawFret = this.getSlideFret(chordNote, this.currentTime);
            }

            if (drawCurrent) {
                this.drawVerticalImageCentered(getImage("FingerOutline"), drawFret - 0.5, this.currentTime, this.getNoteHeadHeight(chordNote), { r: 1, g: 1, b: 1, a: 1 }, 0.05);
                if (chord.Fingers[str] > 0) {
                    this.drawVerticalText(chord.Fingers[str].toString(), drawFret - 0.5, this.getNoteHeadHeight(chordNote), this.currentTime, LABEL_WHITE, 0.05);
                }
            }

            if (!drawCurrent) {
                this.drawSingleNote(chordNote, false, isGhost);

                if (this.nonRepeatNotes.has(note.TimeOffset) && note.TimeOffset > this.currentTime && chordNote.Fret > 0) {
                    this.drawVerticalText(chordNote.Fret.toString(), chordNote.Fret - 0.5, 0, note.TimeOffset, LABEL_WHITE, 0.12);
                }
            }
        }
    }

    // ─── Chord outline ────────────────────────────────────────────────────────

    private drawChordOutline(note: SongNote, isCurrent: boolean): void {
        const chordID = (note.ChordID ?? -1) !== -1 ? note.ChordID! : (note.FingerID ?? -1);
        if (chordID === -1) return;

        const timeOffset = Math.max(note.TimeOffset, this.currentTime);
        const isNonRepeat = this.nonRepeatChords.has(note.TimeOffset);
        const showFull    = isNonRepeat || isCurrent;

        const alpha = hasTech(note, ESongNoteTechnique.Accent) ? 1 : 64 / 255;
        const color = makeColor(1, 1, 1, alpha);

        if (showFull) {
            const endH = this.getStringHeight(this.numStrings);
            this.drawVerticalNinePatch(getImage("ChordOutline"), note.HandFret - 1, note.HandFret + 3, timeOffset, 0, endH, color);
            const chord = this.getChord(chordID);
            if (chord?.Name) {
                this.drawVerticalText(chord.Name, note.HandFret - 1.02, this.getStringHeight(this.numStrings - 1), timeOffset, LABEL_WHITE, 0.09, true);
            }
        } else {
            const shortH = this.getStringHeight(2);
            this.drawVerticalNinePatch(getImage("ChordOutline"), note.HandFret - 1, note.HandFret + 3, timeOffset, 0, shortH, color);

            if (hasTech(note, ESongNoteTechnique.PalmMute) || hasTech(note, ESongNoteTechnique.FretHandMute)) {
                const img = hasTech(note, ESongNoteTechnique.PalmMute) ? getImage("NotePalmMute") : getImage("NoteMute");
                this.drawVerticalImageCentered(img, note.HandFret + 1, timeOffset, this.getStringHeight(0.5), WHITE_HALF, 0.15);
            }
        }
    }

    // ─── Prepass: nonRepeat maps ──────────────────────────────────────────────

    private buildNonRepeatMaps(): void {
        const notes = this.instrumentNotes.Notes;
        const lastStringNote: (SongNote | null)[] = new Array(25).fill(null);
        let lastNote: SongNote | null = null;

        for (const note of notes) {
            if (hasTech(note, ESongNoteTechnique.Continued)) {
                const str = note.String;
                const last = (str === -1) ? null : lastStringNote[str] ?? null;
                if (last !== null && last.String === str) {
                    this.nonRepeatChords.add(last.TimeOffset);
                }
            }

            if (lastNote === null) {
                this.nonRepeatChords.add(note.TimeOffset);
                this.nonRepeatNotes.add(note.TimeOffset);
            } else {
                if (note.HandFret !== lastNote.HandFret) {
                    this.nonRepeatChords.add(note.TimeOffset);
                    this.nonRepeatNotes.add(note.TimeOffset);
                } else if (hasTech(note, ESongNoteTechnique.Chord)) {
                    if (
                        note.TimeLength > 0 ||
                        hasTech(note, ESongNoteTechnique.ChordNote) ||
                        (note.ChordID ?? -1) !== (lastNote.ChordID ?? -1) ||
                        (note.TimeOffset - lastNote.TimeOffset) > 1
                    ) {
                        this.nonRepeatChords.add(note.TimeOffset);
                    }
                } else {
                    if (note.Fret !== lastNote.Fret) this.nonRepeatNotes.add(note.TimeOffset);
                    this.nonRepeatChords.add(note.TimeOffset);
                }
            }

            if ((note.ChordID ?? -1) !== -1) {
                for (let s = 0; s < 6; s++) lastStringNote[s] = note;
            } else {
                const str = note.String;
                if (str >= 0 && str < 25) lastStringNote[str] = note;
            }

            lastNote = note;
        }
    }

    // ─── Helper lookups ───────────────────────────────────────────────────────

    private getChord(chordID: number | undefined) {
        if (chordID === undefined || chordID === -1) return null;
        return this.instrumentNotes.Chords[chordID] ?? null;
    }

    private getStringColor(str: number): UIColor {
        return STRING_COLORS[str + 1]; // stringColorOffset = 1
    }

    private getStringOffset(str: number): number {
        return this.invertStrings ? this.numStrings - str - 1 : str;
    }

    private getStringHeight(str: number): number {
        return 3 + str * 4;
    }

    private getSlideFret(note: SongNote, refTime: number): number {
        const t = clamp((refTime - note.TimeOffset) / note.TimeLength, 0, 1);
        return lerp(note.Fret, note.SlideFret ?? note.Fret, t);
    }

    private getCentsOffset(strng: number, cents: number): number {
        return strng < 2 ? cents / 30 : cents / -30;
    }

    private getBendCents(startTime: number, _strng: number, offsets: CentsOffset[]): number {
        if (startTime > this.currentTime) {
            return offsets[0].TimeOffset === startTime ? offsets[0].Cents : 0;
        }
        let lastCents = 0;
        let lastTime = startTime;
        for (const offset of offsets) {
            if (offset.TimeOffset >= this.currentTime) {
                const t = (offset.TimeOffset - this.currentTime) / (offset.TimeOffset - lastTime);
                return lerp(offset.Cents, lastCents, t);
            }
            lastCents = offset.Cents;
            lastTime = offset.TimeOffset;
        }
        return lastCents;
    }

    private getNoteHeadHeight(note: SongNote): number {
        let h = this.getStringHeight(this.getStringOffset(note.String));
        if (note.CentsOffsets && note.CentsOffsets.length > 0) {
            const bendDir = this.invertStrings ? -1 : 1;
            h += bendDir * this.getCentsOffset(note.String, this.getBendCents(note.TimeOffset, note.String, note.CentsOffsets));
        }
        return h;
    }

    // ─── Text ─────────────────────────────────────────────────────────────────

    // Mirrors C# DrawVerticalText: places a billboarded label in fret/time coordinates.
    // fretCenter → world X via getFretPosition; verticalCenter → world Y; timeCenter → world Z.
    private drawVerticalText(
        text: string,
        fretCenter: number,
        verticalCenter: number,
        timeCenter: number,
        color: UIColor,
        imageScale: number,
        rightAlign = false,
    ): void {
        const x = getFretPosition(fretCenter);
        const y = verticalCenter;
        const z = timeCenter * -this.timeScale;
        this.drawText(text, new THREE.Vector3(x, y, z), color, imageScale, rightAlign);
    }

    // ─── Drawing primitives ───────────────────────────────────────────────────

    // Thin strip in XZ plane at fixed Y, running from startTime to endTime — fret lane line
    private drawFretTimeLine(fretCenter: number, height: number, startTime: number, endTime: number, color: UIColor): void {
        const cx = getFretPosition(fretCenter);
        const sz = startTime * -this.timeScale;
        const ez = endTime   * -this.timeScale;
        const img = getImage("VerticalFretLine");
        const half = img.width * 0.03;
        this.drawQuad(img,
            new THREE.Vector3(cx - half, height, sz), color,
            new THREE.Vector3(cx - half, height, ez), color,
            new THREE.Vector3(cx + half, height, ez), color,
            new THREE.Vector3(cx + half, height, sz), color,
        );
    }

    // Horizontal strip in XZ plane at fixed Y — spans fret range, thin in Z (beat/note shadow)
    private drawFretHorizontalLine(startFret: number, endFret: number, time: number, heightOffset: number, color: UIColor, imageScale: number): void {
        const sx = getFretPosition(startFret);
        const ex = getFretPosition(endFret);
        const z  = time * -this.timeScale;
        const img = getImage("HorizontalFretLine");
        const half = img.height * imageScale;
        this.drawQuad(img,
            new THREE.Vector3(sx, heightOffset, z + half), color,
            new THREE.Vector3(sx, heightOffset, z - half), color,
            new THREE.Vector3(ex, heightOffset, z - half), color,
            new THREE.Vector3(ex, heightOffset, z + half), color,
        );
    }

    // Thin strip in XY plane at fixed Z — spans string height range
    private drawFretVerticalLine(fretCenter: number, time: number, startHeight: number, endHeight: number, color: UIColor, imageScale: number): void {
        const cx = getFretPosition(fretCenter);
        const z  = time * -this.timeScale;
        const img = getImage("VerticalFretLine");
        const half = img.width * imageScale;
        this.drawQuad(img,
            new THREE.Vector3(cx - half, startHeight, z), color,
            new THREE.Vector3(cx - half, endHeight,   z), color,
            new THREE.Vector3(cx + half, endHeight,   z), color,
            new THREE.Vector3(cx + half, startHeight, z), color,
        );
    }

    // Vertical image (XY plane) — explicit fret span + imageScale height
    private drawVerticalImage(image: UIImage, startFret: number, endFret: number, time: number, heightOffset: number, color: UIColor, imageScale: number): void {
        const sx = getFretPosition(startFret);
        const ex = getFretPosition(endFret);
        const z  = time * -this.timeScale;
        const half = image.height * imageScale;
        this.drawQuad(image,
            new THREE.Vector3(sx, heightOffset - half, z), color,
            new THREE.Vector3(sx, heightOffset + half, z), color,
            new THREE.Vector3(ex, heightOffset + half, z), color,
            new THREE.Vector3(ex, heightOffset - half, z), color,
        );
    }

    // Vertical image (XY plane) — centered at a single fret, square extent
    private drawVerticalImageCentered(image: UIImage, fretCenter: number, timeCenter: number, heightOffset: number, color: UIColor, imageScale: number): void {
        const cx = getFretPosition(fretCenter);
        const z  = timeCenter * -this.timeScale;
        const hx = image.width  * imageScale;
        const hy = image.height * imageScale;
        this.drawQuad(image,
            new THREE.Vector3(cx - hx, heightOffset - hy, z), color,
            new THREE.Vector3(cx - hx, heightOffset + hy, z), color,
            new THREE.Vector3(cx + hx, heightOffset + hy, z), color,
            new THREE.Vector3(cx + hx, heightOffset - hy, z), color,
        );
    }

    // Vertical nine-patch (XY plane) — chord outline box
    private drawVerticalNinePatch(image: UIImage, startFret: number, endFret: number, time: number, startHeight: number, endHeight: number, color: UIColor): void {
        const sx = getFretPosition(startFret);
        const ex = getFretPosition(endFret);
        const z  = time * -this.timeScale;
        this.drawNinePatch(
            image, image.width / 2, image.height / 2,
            new THREE.Vector3(sx, startHeight, z),  // bottomLeft
            new THREE.Vector3(sx, endHeight,   z),  // topLeft
            new THREE.Vector3(ex, endHeight,   z),  // topRight
            new THREE.Vector3(ex, startHeight, z),  // bottomRight (unused by drawNinePatch but required by signature)
            color,
        );
    }

    // Flat image (XZ plane) — note trail, centered on fret, narrow X
    private drawFlatImage(image: UIImage, fretCenter: number, startTime: number, endTime: number, heightOffset: number, color: UIColor, imageScale: number): void {
        const cx = getFretPosition(fretCenter);
        const sz = startTime * -this.timeScale;
        const ez = endTime   * -this.timeScale;
        const half = image.width * imageScale;
        this.drawQuad(image,
            new THREE.Vector3(cx - half, heightOffset, sz), color,
            new THREE.Vector3(cx - half, heightOffset, ez), color,
            new THREE.Vector3(cx + half, heightOffset, ez), color,
            new THREE.Vector3(cx + half, heightOffset, sz), color,
        );
    }

    // Flat image (XZ plane) — full fret span (hand position area, open-string trail)
    private drawFlatImageFull(image: UIImage, startFret: number, endFret: number, startTime: number, endTime: number, heightOffset: number, color: UIColor): void {
        const sx = getFretPosition(startFret);
        const ex = getFretPosition(endFret);
        const sz = startTime * -this.timeScale;
        const ez = endTime   * -this.timeScale;
        this.drawQuad(image,
            new THREE.Vector3(sx, heightOffset, sz), color,
            new THREE.Vector3(sx, heightOffset, ez), color,
            new THREE.Vector3(ex, heightOffset, ez), color,
            new THREE.Vector3(ex, heightOffset, sz), color,
        );
    }

    // Slide trail — connects two 3D points (point.Z is in time units, converted here)
    private drawImageTrail(image: UIImage, color: UIColor, imageScale: number, ...points: THREE.Vector3[]): void {
        let last: THREE.Vector3 | null = null;
        for (const point of points) {
            if (last !== null) {
                const lx = getFretPosition(last.x);
                const px = getFretPosition(point.x);
                const lz = last.z  * -this.timeScale;
                const pz = point.z * -this.timeScale;
                const half = image.width * imageScale;
                this.drawQuad(image,
                    new THREE.Vector3(lx - half, last.y,  lz), color,
                    new THREE.Vector3(px - half, point.y, pz), color,
                    new THREE.Vector3(px + half, point.y, pz), color,
                    new THREE.Vector3(lx + half, last.y,  lz), color,
                );
            }
            last = point;
        }
    }

    // Sinusoidal vibrato trail — ~50 quads over the sustain duration
    private drawVibrato(image: UIImage, fretCenter: number, startTime: number, endTime: number, heightOffset: number, color: UIColor): void {
        const imageScale = 0.03;
        const cx = getFretPosition(fretCenter);
        const half = image.width * imageScale;

        let lastTime = startTime;
        let lastHeight = heightOffset;
        const numPoints = Math.floor((endTime - startTime) / 0.02);

        for (let i = 1; i <= numPoints; i++) {
            const time = lerp(startTime, endTime, i / numPoints);
            if (time < this.currentTime) {
                lastTime = this.currentTime;
                continue;
            }
            const height = heightOffset + Math.sin((time - startTime) * 50) * 1;
            const lz = lastTime * -this.timeScale;
            const tz = time    * -this.timeScale;
            this.drawQuad(image,
                new THREE.Vector3(cx - half, lastHeight, lz), color,
                new THREE.Vector3(cx - half, height,     tz), color,
                new THREE.Vector3(cx + half, height,     tz), color,
                new THREE.Vector3(cx + half, lastHeight, lz), color,
            );
            lastHeight = height;
            lastTime   = time;
        }
    }

    // Bend trail — follows CentsOffset array, displaces vertically
    private drawBend(image: UIImage, fretCenter: number, startTime: number, sustain: number, strng: number, offsets: CentsOffset[], color: UIColor): void {
        const endTime = startTime + sustain;
        if (endTime < this.currentTime) return;

        const imageScale = 0.03;
        const cx = getFretPosition(fretCenter);
        const half = image.width * imageScale;
        const baseHeight = this.getStringHeight(strng);

        let lastTime   = startTime;
        let lastHeight = baseHeight;

        for (const offset of offsets) {
            const height = baseHeight + this.getCentsOffset(strng, offset.Cents);
            if (offset.TimeOffset >= this.currentTime && offset.TimeOffset > lastTime) {
                let lt = lastTime;
                let lh = lastHeight;
                if (lt < this.currentTime) {
                    const t = (this.currentTime - lt) / (offset.TimeOffset - lt);
                    lh = lerp(lh, height, t);
                    lt = this.currentTime;
                }
                const lz = lt               * -this.timeScale;
                const oz = offset.TimeOffset * -this.timeScale;
                this.drawQuad(image,
                    new THREE.Vector3(cx - half, lh,     lz), color,
                    new THREE.Vector3(cx - half, height, oz), color,
                    new THREE.Vector3(cx + half, height, oz), color,
                    new THREE.Vector3(cx + half, lh,     lz), color,
                );
            }
            lastHeight = height;
            lastTime   = offset.TimeOffset;
        }

        if (lastTime < endTime) {
            lastTime = Math.max(lastTime, this.currentTime);
            const lz = lastTime * -this.timeScale;
            const ez = endTime  * -this.timeScale;
            this.drawQuad(image,
                new THREE.Vector3(cx - half, lastHeight, lz), color,
                new THREE.Vector3(cx - half, lastHeight, ez), color,
                new THREE.Vector3(cx + half, lastHeight, ez), color,
                new THREE.Vector3(cx + half, lastHeight, lz), color,
            );
        }
    }
}
