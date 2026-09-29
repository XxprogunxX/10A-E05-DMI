import type {
  TechnicalErrorEvent,
  TelemetrySink,
} from '../../domain/telemetry/TelemetrySink';
import { redactTelemetry } from '../../domain/telemetry/redactTelemetry';

export type TelemetryTransport = (event: unknown) => void;

/** Sanitizes every event at the last boundary before its transport. */
export class SafeTelemetrySink implements TelemetrySink {
  constructor(private readonly transport: TelemetryTransport) {}

  record(event: TechnicalErrorEvent): void {
    this.transport(redactTelemetry(event));
  }
}
