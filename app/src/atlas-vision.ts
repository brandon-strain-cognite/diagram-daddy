export type AtlasVisionMode = 'off' | 'auto' | 'always';

export type AtlasVisionSignals = {
  isRaster: boolean;
  handwritingSuspected: boolean;
  connectionUncertain: boolean;
  diagramParsingReturnedNoCandidates: boolean;
  reviewerRequested: boolean;
};

export type AtlasVisionDecision = {
  enabled: boolean;
  reason:
    | 'disabled'
    | 'preview-unavailable'
    | 'always'
    | 'reviewer-requested'
    | 'raster-drawing'
    | 'handwriting-suspected'
    | 'connection-uncertain'
    | 'no-candidates'
    | 'cdf-sufficient';
};

export const DEFAULT_ATLAS_VISION_MODE: AtlasVisionMode = 'off';

export function atlasVisionMode(value: unknown): AtlasVisionMode {
  return value === 'auto' || value === 'always' || value === 'off'
    ? value
    : DEFAULT_ATLAS_VISION_MODE;
}

export function decideAtlasVision(
  mode: AtlasVisionMode,
  previewAvailable: boolean,
  signals: AtlasVisionSignals,
): AtlasVisionDecision {
  if (mode === 'off') return { enabled: false, reason: 'disabled' };
  if (!previewAvailable) return { enabled: false, reason: 'preview-unavailable' };
  if (mode === 'always') return { enabled: true, reason: 'always' };
  if (signals.reviewerRequested) return { enabled: true, reason: 'reviewer-requested' };
  if (signals.handwritingSuspected) return { enabled: true, reason: 'handwriting-suspected' };
  if (signals.connectionUncertain) return { enabled: true, reason: 'connection-uncertain' };
  if (signals.diagramParsingReturnedNoCandidates) return { enabled: true, reason: 'no-candidates' };
  if (signals.isRaster) return { enabled: true, reason: 'raster-drawing' };
  return { enabled: false, reason: 'cdf-sufficient' };
}
