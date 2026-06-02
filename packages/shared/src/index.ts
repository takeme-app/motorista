/**
 * @take-me/shared
 * Tipos, cliente Supabase e utilitários compartilhados entre os apps Take Me.
 */

export { createSupabaseClient } from './supabase';
export type { Database, FiscalDocumentRow } from './types';
export { mapboxForwardGeocode, mapboxGeocodeSuggest } from './mapboxForwardGeocode';
export type { MapboxGeocodeResult } from './mapboxForwardGeocode';
export {
  googleForwardGeocode,
  googleGeocodeSuggest,
  normalizeLocationKey,
} from './googleMapsGeocode';
export type {
  GoogleGeocodeResult,
  GoogleGeocodeSuggestOptions,
} from './googleMapsGeocode';
export { getOrCreateActiveSupportConversationId } from './supportConversation';
export {
  MAPBOX_NATIVE_MAP_STYLE_URL,
  MAPBOX_ROUTE_STROKE_COLOR,
  MAPBOX_ORIGIN_MARKER_COLOR,
  MAPBOX_DESTINATION_MARKER_COLOR,
} from './mapboxNativeMapStyle';
export {
  computeOrderPricing,
  chargeAmountCentsOf,
  applicationFeeCentsOf,
  formatPricingBreakdown,
  formatPricingSummary,
  normalizeApplyPromotion,
  PricingDenominatorOverflowError,
  DEFAULT_PLATFORM_FEE_PCT,
  MAX_PLATFORM_FEE_PCT,
  PLATFORM_FEE_SERVICE_TYPES,
  isPlatformFeeServiceType,
  normalizePlatformFeePctByService,
  resolvePlatformFeePct,
} from './orderPricing';
export type {
  PricingInput,
  PricingResult,
  ApplyPromotionResult,
  PlatformFeePctByService,
  PlatformFeeServiceType,
} from './orderPricing';
export {
  formatDependentShipmentCode,
  formatEntityCode,
  formatShipmentCode,
  formatTripCode,
} from './orderCodes';
export { useBottomSafeInset } from './useBottomSafeInset';
