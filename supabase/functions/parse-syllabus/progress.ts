// Keeps syllabus_uploads.progress_note current while Claude streams: a timer re-evaluates the
// note every few seconds from elapsed time and the JSON section being written, and writes it
// only when it changes. Writes are serialized so stop() can wait for the last one.
import { detectSection, progressNoteFor, type UploadKind } from '../_shared/prompts.ts';

export class ProgressReporter {
  #section: string | null = null;
  #lastNote: string | null = null;
  #startedAt = 0;
  #timer: ReturnType<typeof setInterval> | undefined;
  #pending: Promise<void> = Promise.resolve();

  constructor(
    private readonly kind: UploadKind,
    private readonly write: (note: string) => Promise<void>,
    private readonly intervalMs = 3000,
  ) {}

  start(): void {
    this.#startedAt = Date.now();
    this.#tick();
    this.#timer = setInterval(() => this.#tick(), this.intervalMs);
  }

  /** Stream `text` listener. Looks only at the new delta plus a short overlap for split keys. */
  readonly onText = (delta: string, snapshot: string): void => {
    const section = detectSection(this.kind, snapshot.slice(-(delta.length + 40)));
    if (section) this.#section = section;
  };

  async stop(): Promise<void> {
    if (this.#timer !== undefined) clearInterval(this.#timer);
    this.#timer = undefined;
    await this.#pending;
  }

  #tick(): void {
    const note = progressNoteFor(this.kind, { elapsedMs: Date.now() - this.#startedAt, section: this.#section });
    if (note === this.#lastNote) return;
    this.#lastNote = note;
    this.#pending = this.#pending.then(() => this.write(note)).catch(() => undefined);
  }
}
