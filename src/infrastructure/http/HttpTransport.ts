export interface HttpRequest {
  readonly url: string;
  readonly method: 'GET' | 'POST';
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: string;
  readonly timeoutMs: number;
}

export interface HttpResponse {
  readonly status: number;
  readonly body: string;
}

export interface HttpTransport {
  request(input: HttpRequest): Promise<HttpResponse>;
}

export class HttpTransportFailure extends Error {
  readonly name = 'HttpTransportFailure';

  constructor(readonly kind: 'timeout' | 'network') {
    super(kind);
  }
}

/** Fetch adapter. Provider errors are reduced to safe transport categories. */
export class FetchHttpTransport implements HttpTransport {
  async request(input: HttpRequest): Promise<HttpResponse> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), input.timeoutMs);

    try {
      const response = await fetch(input.url, {
        method: input.method,
        headers: { ...input.headers },
        ...(input.body === undefined ? {} : { body: input.body }),
        signal: controller.signal,
      });

      return {
        status: response.status,
        body: await response.text(),
      };
    } catch (error: unknown) {
      if (
        controller.signal.aborted ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
        throw new HttpTransportFailure('timeout');
      }
      throw new HttpTransportFailure('network');
    } finally {
      clearTimeout(timeout);
    }
  }
}
