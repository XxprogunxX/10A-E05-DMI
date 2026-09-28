export type TechnicalErrorEvent = Readonly<{
  operation: string;
  correlationId: string;
  status: 'failed';
  attempt: number;
}>;

/** Domain port for recording already-minimized technical events. */
export interface TelemetrySink {
  record(event: TechnicalErrorEvent): void;
}
