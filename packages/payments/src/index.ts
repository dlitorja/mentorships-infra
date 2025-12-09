// Export Stripe client and utilities
export * from "./stripe/client";
export * from "./stripe/checkout";
export * from "./stripe/webhooks";
export * from "./stripe/refunds";

// Export types
export type * from "./stripe/types";

// Export PayPal client and utilities
// Note: Some function names conflict with Stripe (e.g., createRefund, verifyWebhookSignature)
// Import these with aliases if needed, or use namespace imports
export {
  getPayPalClient,
  getPayPalClientId,
  getPayPalClientSecret,
} from "./paypal/client";
export {
  createPayPalOrder,
  capturePayPalOrder,
  getPayPalOrder,
} from "./paypal/orders";
export {
  verifyWebhookSignature as verifyPayPalWebhookSignature,
  getWebhookId as getPayPalWebhookId,
  parseWebhookEvent as parsePayPalWebhookEvent,
  isPaymentCaptureCompletedEvent,
  isPaymentCaptureRefundedEvent,
} from "./paypal/webhooks";
export {
  createRefund as createPayPalRefund,
  calculateRefundAmount as calculatePayPalRefundAmount,
} from "./paypal/refunds";

// Export PayPal types
export type * from "./paypal/types";

