export interface PaymentRequest {
  correlationId: string;
  amount: number;
}

export interface PaymentData {
  correlationId: string;
  amount: number;
  processor: string;
  requested_at: number;
}

export interface GatewayHealth {
  failing: boolean;
  minResponseTime: number;
}

export interface PaymentSummary {
  default: {
    totalRequests: number;
    totalAmount: number;
  };
  fallback: {
    totalRequests: number;
    totalAmount: number;
  };
}

export interface QueueItem {
  correlationId: string;
  amount: number;
}

export interface CacheData {
  data: [string, string]; // [url, name]
  ts: number;
}
