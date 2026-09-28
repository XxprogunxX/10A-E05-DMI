import type {
  TechnicalErrorEvent,
  TelemetrySink,
} from '../../domain/telemetry/TelemetrySink';

export type TechnicalErrorContext = Readonly<
  Omit<TechnicalErrorEvent, 'status'>
>;

export class ReportTechnicalError {
  constructor(private readonly telemetry: TelemetrySink) {}

  execute(context: TechnicalErrorContext, _error: unknown): void {
    try {
      this.telemetry.record({
        operation: context.operation,
        correlationId: context.correlationId,
        status: 'failed',
        attempt: context.attempt,
      });
    } catch {
      // Telemetry is best effort and must not replace the original UI outcome.
    }
  }
}
