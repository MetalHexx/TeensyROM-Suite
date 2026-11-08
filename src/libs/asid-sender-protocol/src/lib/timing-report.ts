/** Lateness in milliseconds. A percentile read from a histogram is good to its 0.1 ms bin. */
export interface LatenessSummary {
  readonly count: number;
  readonly p50: number;
  readonly p99: number;
  readonly max: number;
}

export interface CartridgeTiming {
  readonly token: string;
  readonly packets: number;
  /** Stamped frames that reached the sender past their due time, and by how much at worst; spare time for the rest. */
  readonly arrival: {
    readonly pastDue: number;
    readonly pastDueMaxMs: number;
    readonly spareMinMs: number;
    readonly spareP1Ms: number;
    readonly spareP50Ms: number;
  };
  /** How long after its due time each stamped frame left; own = frames that arrived on time and still left late. */
  readonly send: LatenessSummary & {
    readonly ownOver2Ms: number;
    readonly ownOver5Ms: number;
    readonly ownMaxMs: number;
  };
  readonly gaps: {
    readonly medianMs: number;
    readonly within1MsPct: number;
    readonly offOver5Ms: number;
  };
  readonly failedSends: number;
  /** Invalid packets, and packets for a cartridge the sender does not list. */
  readonly dropped: number;
}

export interface TimelineRow {
  /** Seconds since the record started or was cleared. */
  readonly atS: number;
  readonly visibility: 'visible' | 'hidden';
  readonly marginMaxMs: number;
  readonly wakeMaxMs: number;
  readonly cartridges: readonly {
    readonly token: string;
    readonly packets: number;
    readonly pastDue: number;
    readonly lateMaxMs: number;
    readonly ownMaxMs: number;
    readonly within1MsPct: number;
  }[];
}

export interface SenderTimingReport {
  readonly sinceS: number;
  readonly marginMs: { readonly now: number; readonly max: number };
  readonly wake: LatenessSummary;
  readonly cartridges: readonly CartridgeTiming[];
  readonly timeline: readonly TimelineRow[];
  readonly visibility: readonly { readonly atS: number; readonly state: 'visible' | 'hidden' }[];
  /** The longest gap between the app's pings; recorded, never acted on. */
  readonly appQuietMaxMs: number;
}
