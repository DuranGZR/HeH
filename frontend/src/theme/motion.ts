/** Lightweight animation tokens with OS Reduce Motion compliance. */

export const MOTION_DURATIONS = {
  instant: 0,
  fast: 120,
  normal: 200,
  pulse: 1100,
} as const;

export type MotionEasingName = "standard" | "decelerate" | "linear";

export interface ResolvedMotionSpec {
  readonly reducedMotion: boolean;
  readonly fastMs: number;
  readonly normalMs: number;
  readonly pulseMs: number;
  readonly allowScaleTransforms: boolean;
  readonly allowLoopingPulse: boolean;
  readonly easing: MotionEasingName;
}

/**
 * Resolve animation timings respecting accessibility Reduce Motion preference.
 * When `reducedMotion` is enabled, transitions snap cleanly without scaling/pulsing.
 */
export function resolveMotionSpec(reducedMotion: boolean): ResolvedMotionSpec {
  if (reducedMotion) {
    return {
      reducedMotion: true,
      fastMs: MOTION_DURATIONS.instant,
      normalMs: MOTION_DURATIONS.instant,
      pulseMs: MOTION_DURATIONS.instant,
      allowScaleTransforms: false,
      allowLoopingPulse: false,
      easing: "linear",
    };
  }

  return {
    reducedMotion: false,
    fastMs: MOTION_DURATIONS.fast,
    normalMs: MOTION_DURATIONS.normal,
    pulseMs: MOTION_DURATIONS.pulse,
    allowScaleTransforms: true,
    allowLoopingPulse: true,
    easing: "standard",
  };
}
