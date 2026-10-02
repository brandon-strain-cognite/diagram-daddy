import { describe, expect, it } from 'vitest';

import { atlasVisionMode, decideAtlasVision, type AtlasVisionSignals } from './atlas-vision';

const cleanVector: AtlasVisionSignals = {
  isRaster: false,
  handwritingSuspected: false,
  connectionUncertain: false,
  diagramParsingReturnedNoCandidates: false,
  reviewerRequested: false,
};

describe('Atlas vision feature gate', () => {
  it('defaults invalid configuration to off', () => {
    expect(atlasVisionMode(undefined)).toBe('off');
    expect(atlasVisionMode('experimental')).toBe('off');
  });

  it('keeps vision off even when preview access exists', () => {
    expect(decideAtlasVision('off', true, { ...cleanVector, isRaster: true })).toEqual({
      enabled: false,
      reason: 'disabled',
    });
  });

  it('falls back to CDF-only review when preview access is unavailable', () => {
    expect(decideAtlasVision('auto', false, { ...cleanVector, isRaster: true })).toEqual({
      enabled: false,
      reason: 'preview-unavailable',
    });
  });

  it.each([
    [{ ...cleanVector, isRaster: true }, 'raster-drawing'],
    [{ ...cleanVector, handwritingSuspected: true }, 'handwriting-suspected'],
    [{ ...cleanVector, connectionUncertain: true }, 'connection-uncertain'],
    [{ ...cleanVector, diagramParsingReturnedNoCandidates: true }, 'no-candidates'],
    [{ ...cleanVector, reviewerRequested: true }, 'reviewer-requested'],
  ] as const)('selects vision in auto mode for %s', (signals, reason) => {
    expect(decideAtlasVision('auto', true, signals)).toEqual({ enabled: true, reason });
  });

  it('skips vision when CDF is sufficient for a vector drawing', () => {
    expect(decideAtlasVision('auto', true, cleanVector)).toEqual({
      enabled: false,
      reason: 'cdf-sufficient',
    });
  });

  it('supports an always-on benchmark mode', () => {
    expect(decideAtlasVision('always', true, cleanVector)).toEqual({
      enabled: true,
      reason: 'always',
    });
  });
});
