/** One terminal abort shared by response-start and streaming-body boundaries. */
export class CaptureTimeout {
  public readonly controller = new AbortController();
  public reason = 'The capture was externally aborted.';
  private requestTimer?: ReturnType<typeof setTimeout>;
  private idleTimer?: ReturnType<typeof setTimeout>;
  private bodyTimer?: ReturnType<typeof setTimeout>;
  private readonly abortFromCaller = () => this.abort('The capture was externally aborted.');

  public constructor(
    requestMs: number,
    private readonly idleMs: number,
    private readonly bodyMs: number,
    private readonly caller?: AbortSignal,
  ) {
    this.requestTimer = setTimeout(
      () => this.abort('The request/response-start timeout was exceeded.'),
      requestMs,
    );
    caller?.addEventListener('abort', this.abortFromCaller, { once: true });
    if (caller?.aborted) this.abortFromCaller();
  }

  private abort(reason: string): void {
    if (this.controller.signal.aborted) return;
    this.reason = reason;
    this.controller.abort();
  }

  public startBody(): void {
    clearTimeout(this.requestTimer);
    this.bodyTimer = setTimeout(
      () => this.abort('The absolute body-transfer timeout was exceeded.'),
      this.bodyMs,
    );
    this.progress();
  }

  public progress(): void {
    if (this.controller.signal.aborted) return;
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(
      () => this.abort('The body inactivity timeout was exceeded.'),
      this.idleMs,
    );
  }

  /** Bound even injected transports/readers that ignore the fetch signal. */
  public async wait<T>(operation: () => Promise<T>): Promise<T> {
    const signal = this.controller.signal;
    if (signal.aborted) throw new Error(this.reason);
    let onAbort: () => void = () => {};
    const aborted = new Promise<never>((_resolve, reject) => {
      onAbort = () => reject(new Error(this.reason));
      signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      const value = await Promise.race([operation(), aborted]);
      if (signal.aborted) throw new Error(this.reason);
      return value;
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }

  public dispose(): void {
    clearTimeout(this.requestTimer);
    clearTimeout(this.idleTimer);
    clearTimeout(this.bodyTimer);
    this.caller?.removeEventListener('abort', this.abortFromCaller);
  }
}
