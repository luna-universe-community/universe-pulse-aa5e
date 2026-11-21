// Pulse: logic that does not touch the DOM, so tests can exercise it against Luna.MockEngine.

const PALETTE = [190, 285, 330, 45, 140, 210, 15, 260, 95, 170];

const AddOnLogic = {
  /** Meter level 0..1 for a track (LUNA's meters are 0..1). */
  meterLevel(track) {
    const m = track.meter;
    if (!m) return 0;
    const v = typeof m.max === 'number' ? m.max : 0;
    return Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
  },

  /** Hue for a track: from LUNA's packed ARGB colour when set, else a palette. */
  hue(argb, index) {
    if (typeof argb === 'number' && argb !== 0) {
      const r = ((argb >>> 16) & 255) / 255, g = ((argb >>> 8) & 255) / 255, b = (argb & 255) / 255;
      const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
      if (d > 0.05) {
        let h;
        if (max === r) h = ((g - b) / d) % 6;
        else if (max === g) h = (b - r) / d + 2;
        else h = (r - g) / d + 4;
        return Math.round((h * 60 + 360) % 360);
      }
    }
    return PALETTE[index % PALETTE.length];
  },

  /** What to draw for each visible track. */
  voices(session) {
    return session.visibleTracks.map((t, i) => ({
      id: t.id,
      name: t.name.value ?? t.id,
      hue: AddOnLogic.hue(t.color?.value, i),
      muted: t.mute?.on === true,
      level: AddOnLogic.meterLevel(t),
    }));
  },

  /** Fast attack, slow release smoothing for a displayed level. dt in seconds. */
  smooth(prev, target, dt) {
    const tau = target > prev ? 0.03 : 0.35;
    const k = 1 - Math.exp(-dt / tau);
    return prev + (target - prev) * k;
  },

  /** Perceptual shaping so quiet tracks still move: 0..1 -> 0..1. */
  shape(level) {
    return Math.pow(Math.max(0, Math.min(1, level)), 0.6);
  },
};

globalThis.AddOnLogic = AddOnLogic;
