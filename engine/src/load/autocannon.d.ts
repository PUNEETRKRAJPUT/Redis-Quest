// Minimal types for the parts of autocannon 8 the engine uses (the package ships no types).
declare module 'autocannon' {
  export interface Histogram {
    average: number;
    mean?: number;
    min: number;
    max: number;
    p50: number;
    p90: number;
    p99: number;
    total?: number;
    sent?: number;
  }
  export interface Result {
    latency: Histogram;
    requests: Histogram;
    duration: number;
    errors: number;
    timeouts: number;
    non2xx: number;
    '2xx': number;
    statusCodeStats: Record<string, { count: number }>;
    start: Date;
    finish: Date;
  }
  export interface RawRequest {
    method?: string;
    path?: string;
    headers?: Record<string, string>;
    body?: string | Buffer;
  }
  export interface RequestSpec extends RawRequest {
    setupRequest?: (req: RawRequest, context: Record<string, unknown>) => RawRequest;
  }
  export interface Options {
    url: string;
    connections?: number;
    duration?: number;
    pipelining?: number;
    timeout?: number;
    requests?: RequestSpec[];
  }
  function autocannon(opts: Options): Promise<Result>;
  export default autocannon;
}
