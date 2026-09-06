export function comparePluginVersion(left = '', right = '') {
  const parse = (value) => String(value).replace(/^v/i, '').split(/[.+-]/).map((part) => /^\d+$/.test(part) ? Number(part) : part);
  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const av = a[index] ?? 0;
    const bv = b[index] ?? 0;
    if (typeof av === 'number' && typeof bv === 'number' && av !== bv) return av - bv;
    if (String(av) !== String(bv)) return String(av).localeCompare(String(bv));
  }
  return 0;
}

export function selectSkillCandidate(candidates, preferredVersion = null) {
  return [...candidates].sort((left, right) => {
    const preferred = (candidate) => preferredVersion && candidate.version === preferredVersion ? 1 : 0;
    const preferredDifference = preferred(right) - preferred(left);
    if (preferredDifference) return preferredDifference;
    const versionDifference = comparePluginVersion(right.version, left.version);
    if (versionDifference) return versionDifference;
    const depthDifference = left.relativePath.split('/').length - right.relativePath.split('/').length;
    if (depthDifference) return depthDifference;
    return left.relativePath.localeCompare(right.relativePath);
  })[0];
}
