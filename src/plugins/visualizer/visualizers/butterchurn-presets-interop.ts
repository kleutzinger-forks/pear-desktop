// `butterchurn-presets`' bundled UMD output can come back wrapped in one or
// more `{ default: ... }` interop layers depending on how/where it's
// imported, instead of handing back the flat presets map directly. Peel
// those off so callers always get `{ [presetName]: presetData }`.
export const unwrapButterchurnPresets = (
  mod: unknown,
): Record<string, unknown> => {
  let candidate = mod as Record<string, unknown>;
  while (
    candidate &&
    typeof candidate === 'object' &&
    Object.keys(candidate).length === 1 &&
    'default' in candidate
  ) {
    candidate = candidate.default as Record<string, unknown>;
  }
  return candidate;
};
