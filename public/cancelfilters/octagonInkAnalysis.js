/**
 * @fileoverview Octagon ink-distribution analysis for U.S. Supplementary Mail Type A cancels.
 *
 * Geometry describes where the Type A octagon is expected; ink analysis measures dark-pixel
 * content inside a configurable outer ring (outer octagon minus inset octagon). Geometry is
 * never redefined from measured ink.
 *
 * Angle convention (degrees):
 *   0° = North, increasing clockwise
 *   0° N, 45° NE, 90° E, 135° SE, 180° S, 225° SW, 270° W, 315° NW
 *
 * Browser-only ES module; no Node.js or third-party dependencies.
 */

/** @typedef {{ cx: number, cy: number, width: number, height: number, corner: number, rotation: number, innerInset?: number }} OctagonGeometry */

/** @typedef {{ grayscaleThreshold?: number, alphaThreshold?: number, binCount?: number, degreesPerBin?: number }} InkAnalysisOptions */

/** @typedef {{ angleStart: number, angleEnd: number, angleCenter: number, validPixels: number, inkPixels: number, density: number }} AngularBin */

/** @typedef {{ name: string, angleStart: number, angleEnd: number, validPixels: number, inkPixels: number, density: number }} CompassSector */

/** @typedef {{ meanDensity: number, minDensity: number, maxDensity: number, standardDeviation: number, coefficientOfVariation: number, imbalanceScore: number, strongestSector: string|null, weakestSector: string|null, sectorsAboveMean: string[], sectorsBelowMean: string[] }} InkStatistics */

/** @typedef {{ geometry: OctagonGeometry, angularProfile: AngularBin[], sectors: CompassSector[], statistics: InkStatistics, strongestSector: CompassSector|null, weakestSector: CompassSector|null, weightedMeanAngle: number|null, directionalConcentration: number }} OctagonInkAnalysisResult */

const DEFAULT_WIDTH = 23;
const DEFAULT_HEIGHT = 13.2;
const DEFAULT_CORNER = 2.75;
const DEFAULT_INNER_INSET = 1.5;
const DEFAULT_BIN_COUNT = 72;
const DEFAULT_DEGREES_PER_BIN = 5;
const DEFAULT_GRAYSCALE_THRESHOLD = 128;
const DEFAULT_ALPHA_THRESHOLD = 1;
const SECTOR_HALF_WIDTH = 22.5;
const TWO_PI = Math.PI * 2;

/** @type {ReadonlyArray<{ name: string, center: number }>} */
const COMPASS_DEFS = Object.freeze([
  { name: 'N', center: 0 },
  { name: 'NE', center: 45 },
  { name: 'E', center: 90 },
  { name: 'SE', center: 135 },
  { name: 'S', center: 180 },
  { name: 'SW', center: 225 },
  { name: 'W', center: 270 },
  { name: 'NW', center: 315 },
]);

/**
 * Normalize an angle in degrees to [0, 360).
 * @param {number} degrees
 * @returns {number}
 */
export function normalizeAngle(degrees) {
  if (!Number.isFinite(degrees)) {
    throw new TypeError('Angle must be a finite number');
  }
  let a = degrees % 360;
  if (a < 0) a += 360;
  return a;
}

/**
 * Shortest signed angular difference b − a in degrees, in (−180, 180].
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export function angleDifference(a, b) {
  let d = normalizeAngle(b) - normalizeAngle(a);
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/**
 * Whether angle lies in [start, end) on a circle (degrees). Handles wrap across 0°.
 * When start === end, the range is treated as the full circle.
 * @param {number} angle
 * @param {number} start
 * @param {number} end
 * @returns {boolean}
 */
export function angleInRange(angle, start, end) {
  const a = normalizeAngle(angle);
  const s = normalizeAngle(start);
  const e = normalizeAngle(end);
  if (s === e) return true;
  if (s < e) return a >= s && a < e;
  return a >= s || a < e;
}

/**
 * Perceptual luminance (Rec. 601) from 0–255 RGB channels.
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @returns {number}
 */
export function luminance(r, g, b) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/**
 * Validate and normalize octagon geometry. Does not mutate the input object.
 * Defaults (width/height/corner/innerInset) come from {@link getDefaultTypeAGeometry};
 * analysis logic never embeds those defaults itself beyond this normalizer.
 * @param {Partial<OctagonGeometry>} [geometry]
 * @returns {Required<OctagonGeometry>}
 */
export function normalizeGeometry(geometry = {}) {
  if (geometry == null || typeof geometry !== 'object') {
    throw new TypeError('geometry must be an object');
  }

  const cx = geometry.cx ?? 0;
  const cy = geometry.cy ?? 0;
  const width = geometry.width ?? DEFAULT_WIDTH;
  const height = geometry.height ?? DEFAULT_HEIGHT;
  const corner = geometry.corner ?? DEFAULT_CORNER;
  const rotation = geometry.rotation ?? 0;
  const innerInset = geometry.innerInset ?? DEFAULT_INNER_INSET;

  assertFiniteNumber(cx, 'cx');
  assertFiniteNumber(cy, 'cy');
  assertFiniteNumber(width, 'width');
  assertFiniteNumber(height, 'height');
  assertFiniteNumber(corner, 'corner');
  assertFiniteNumber(rotation, 'rotation');
  assertFiniteNumber(innerInset, 'innerInset');

  if (width <= 0) throw new RangeError('width must be > 0');
  if (height <= 0) throw new RangeError('height must be > 0');
  if (corner < 0) throw new RangeError('corner must be >= 0');
  if (corner * 2 > width) throw new RangeError('corner * 2 must be <= width');
  if (corner * 2 > height) throw new RangeError('corner * 2 must be <= height');
  if (innerInset < 0) throw new RangeError('innerInset must be >= 0');

  const maxInset = Math.min(width, height) / 2;
  if (innerInset >= maxInset) {
    throw new RangeError('innerInset must leave a positive-size inner octagon');
  }

  return { cx, cy, width, height, corner, rotation, innerInset };
}

/**
 * Local (unrotated, origin at top-left of bounding box) octagon vertices.
 * @param {number} width
 * @param {number} height
 * @param {number} corner
 * @returns {Float64Array} interleaved x,y pairs (length 16)
 */
export function localOctagonVertices(width, height, corner) {
  assertFiniteNumber(width, 'width');
  assertFiniteNumber(height, 'height');
  assertFiniteNumber(corner, 'corner');
  if (width <= 0 || height <= 0) throw new RangeError('width and height must be > 0');
  if (corner < 0 || corner * 2 > width || corner * 2 > height) {
    throw new RangeError('invalid corner for given width/height');
  }

  const v = new Float64Array(16);
  v[0] = corner;
  v[1] = 0;
  v[2] = width - corner;
  v[3] = 0;
  v[4] = width;
  v[5] = corner;
  v[6] = width;
  v[7] = height - corner;
  v[8] = width - corner;
  v[9] = height;
  v[10] = corner;
  v[11] = height;
  v[12] = 0;
  v[13] = height - corner;
  v[14] = 0;
  v[15] = corner;
  return v;
}

/**
 * Inner-boundary parameters for an inset octagon sharing the same center and rotation.
 * Width/height shrink by 2×inset; corner is reduced by inset (clamped to remain valid).
 * @param {number} width
 * @param {number} height
 * @param {number} corner
 * @param {number} inset
 * @returns {{ width: number, height: number, corner: number }}
 */
export function insetOctagonParams(width, height, corner, inset) {
  assertFiniteNumber(width, 'width');
  assertFiniteNumber(height, 'height');
  assertFiniteNumber(corner, 'corner');
  assertFiniteNumber(inset, 'inset');
  if (inset < 0) throw new RangeError('inset must be >= 0');
  if (inset >= Math.min(width, height) / 2) {
    throw new RangeError('inset must leave a positive-size inner octagon');
  }

  const innerWidth = width - 2 * inset;
  const innerHeight = height - 2 * inset;
  let innerCorner = Math.max(0, corner - inset);
  if (innerCorner * 2 > innerWidth) innerCorner = innerWidth / 2;
  if (innerCorner * 2 > innerHeight) innerCorner = innerHeight / 2;
  return { width: innerWidth, height: innerHeight, corner: innerCorner };
}

/**
 * World-space octagon vertices centered at (cx, cy) with rotation in degrees.
 * Positive rotation is clockwise in canvas coordinates (Y increases downward).
 * @param {Partial<OctagonGeometry>} geometry
 * @param {'outer'|'inner'} [boundary='outer']
 * @returns {Float64Array} interleaved x,y (8 vertices)
 */
export function getOctagonVertices(geometry, boundary = 'outer') {
  const g = normalizeGeometry(geometry);
  let width = g.width;
  let height = g.height;
  let corner = g.corner;

  if (boundary === 'inner') {
    const inner = insetOctagonParams(g.width, g.height, g.corner, g.innerInset);
    width = inner.width;
    height = inner.height;
    corner = inner.corner;
  } else if (boundary !== 'outer') {
    throw new RangeError('boundary must be "outer" or "inner"');
  }

  const local = localOctagonVertices(width, height, corner);
  const out = new Float64Array(16);
  const cos = Math.cos((g.rotation * Math.PI) / 180);
  const sin = Math.sin((g.rotation * Math.PI) / 180);
  const ox = width / 2;
  const oy = height / 2;

  for (let i = 0; i < 8; i++) {
    const lx = local[i * 2] - ox;
    const ly = local[i * 2 + 1] - oy;
    // Clockwise rotation with Y-down canvas:
    // [ cos  sin] [lx]
    // [-sin  cos] [ly]
    const rx = lx * cos + ly * sin;
    const ry = -lx * sin + ly * cos;
    out[i * 2] = g.cx + rx;
    out[i * 2 + 1] = g.cy + ry;
  }
  return out;
}

/**
 * Axis-aligned bounding box of a vertex list.
 * @param {Float64Array|ArrayLike<number>} vertices interleaved x,y
 * @returns {{ minX: number, minY: number, maxX: number, maxY: number }}
 */
export function verticesBounds(vertices) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const n = vertices.length;
  for (let i = 0; i < n; i += 2) {
    const x = vertices[i];
    const y = vertices[i + 1];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Point-in-polygon test (even-odd / ray casting) for a closed simple polygon.
 * @param {number} x
 * @param {number} y
 * @param {Float64Array|ArrayLike<number>} vertices interleaved x,y
 * @returns {boolean}
 */
export function pointInPolygon(x, y, vertices) {
  const n = vertices.length;
  if (n < 6) return false;
  let inside = false;
  for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
    const xi = vertices[i];
    const yi = vertices[i + 1];
    const xj = vertices[j];
    const yj = vertices[j + 1];
    if ((yi > y) !== (yj > y)) {
      const denom = yj - yi;
      if (denom !== 0 && x < ((xj - xi) * (y - yi)) / denom + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

/**
 * Angle of point (x, y) relative to center (cx, cy).
 * 0° = North (negative Y in canvas space), increasing clockwise, range [0, 360).
 * @param {number} x
 * @param {number} y
 * @param {number} cx
 * @param {number} cy
 * @returns {number}
 */
export function pixelAngle(x, y, cx, cy) {
  const dx = x - cx;
  const dy = y - cy;
  // atan2(dx, -dy): north → 0, east → +90°, clockwise positive
  let deg = (Math.atan2(dx, -dy) * 180) / Math.PI;
  if (deg < 0) deg += 360;
  return deg;
}

/**
 * Whether a point lies in the analysis ring: inside outer octagon and outside inner octagon.
 * @param {number} x
 * @param {number} y
 * @param {Partial<OctagonGeometry>} geometry
 * @param {{ outerVertices?: Float64Array, innerVertices?: Float64Array }} [cache]
 * @returns {boolean}
 */
export function isInAnalysisRing(x, y, geometry, cache) {
  const outer = cache?.outerVertices ?? getOctagonVertices(geometry, 'outer');
  const inner = cache?.innerVertices ?? getOctagonVertices(geometry, 'inner');
  return pointInPolygon(x, y, outer) && !pointInPolygon(x, y, inner);
}

/**
 * Whether a pixel is considered ink given luminance and alpha thresholds.
 * Darker than or equal to grayscaleThreshold counts as ink (when alpha is sufficient).
 * @param {number} r
 * @param {number} g
 * @param {number} b
 * @param {number} a
 * @param {number} grayscaleThreshold
 * @param {number} alphaThreshold
 * @returns {boolean}
 */
export function isInkPixel(r, g, b, a, grayscaleThreshold, alphaThreshold) {
  if (a < alphaThreshold) return false;
  return luminance(r, g, b) <= grayscaleThreshold;
}

/**
 * Whether a pixel is a valid sample (sufficient alpha). Transparent pixels are skipped.
 * @param {number} a
 * @param {number} alphaThreshold
 * @returns {boolean}
 */
export function isValidPixel(a, alphaThreshold) {
  return a >= alphaThreshold;
}

/**
 * Build empty angular bins covering [0, 360).
 * @param {number} [binCount=72]
 * @param {number} [degreesPerBin=5]
 * @returns {AngularBin[]}
 */
export function createAngularBins(
  binCount = DEFAULT_BIN_COUNT,
  degreesPerBin = DEFAULT_DEGREES_PER_BIN,
) {
  assertPositiveInteger(binCount, 'binCount');
  assertFiniteNumber(degreesPerBin, 'degreesPerBin');
  if (degreesPerBin <= 0) throw new RangeError('degreesPerBin must be > 0');
  if (Math.abs(binCount * degreesPerBin - 360) > 1e-9) {
    throw new RangeError('binCount * degreesPerBin must equal 360');
  }

  /** @type {AngularBin[]} */
  const bins = new Array(binCount);
  for (let i = 0; i < binCount; i++) {
    const angleStart = i * degreesPerBin;
    const angleEnd = (i + 1) * degreesPerBin;
    bins[i] = {
      angleStart,
      angleEnd,
      angleCenter: angleStart + degreesPerBin / 2,
      validPixels: 0,
      inkPixels: 0,
      density: 0,
    };
  }
  return bins;
}

/**
 * Aggregate angular bins into eight 45° compass sectors centered on N, NE, E, SE, S, SW, W, NW.
 * Densities use actual valid-pixel counts (sectors need not cover equal area in pixels).
 * @param {AngularBin[]} angularProfile
 * @returns {CompassSector[]}
 */
export function getCompassSectors(angularProfile) {
  if (!Array.isArray(angularProfile)) {
    throw new TypeError('angularProfile must be an array');
  }

  /** @type {CompassSector[]} */
  const sectors = COMPASS_DEFS.map(({ name, center }) => {
    const angleStart = normalizeAngle(center - SECTOR_HALF_WIDTH);
    const angleEnd = normalizeAngle(center + SECTOR_HALF_WIDTH);
    return {
      name,
      angleStart,
      angleEnd,
      validPixels: 0,
      inkPixels: 0,
      density: 0,
    };
  });

  for (const bin of angularProfile) {
    if (!bin || typeof bin !== 'object') continue;
    const idx = sectorIndexForAngle(bin.angleCenter);
    sectors[idx].validPixels += bin.validPixels | 0;
    sectors[idx].inkPixels += bin.inkPixels | 0;
  }

  for (const s of sectors) {
    s.density = s.validPixels > 0 ? s.inkPixels / s.validPixels : 0;
  }

  return sectors;
}

/**
 * Sector index 0..7 for an angle in degrees (N wraps across 0°/360°).
 * @param {number} angle
 * @returns {number}
 */
function sectorIndexForAngle(angle) {
  const a = normalizeAngle(angle);
  return Math.floor(normalizeAngle(a + SECTOR_HALF_WIDTH) / 45) % 8;
}

/**
 * Summary statistics from compass sectors.
 * @param {CompassSector[]} sectors
 * @returns {InkStatistics}
 */
export function getInkStatistics(sectors) {
  if (!Array.isArray(sectors) || sectors.length === 0) {
    throw new TypeError('sectors must be a non-empty array');
  }

  let sum = 0;
  let minDensity = Infinity;
  let maxDensity = -Infinity;
  /** @type {string|null} */
  let strongest = null;
  /** @type {string|null} */
  let weakest = null;

  for (const s of sectors) {
    const d = s.density;
    sum += d;
    if (d < minDensity) {
      minDensity = d;
      weakest = s.name;
    }
    if (d > maxDensity) {
      maxDensity = d;
      strongest = s.name;
    }
  }

  const n = sectors.length;
  const meanDensity = sum / n;

  let varSum = 0;
  /** @type {string[]} */
  const sectorsAboveMean = [];
  /** @type {string[]} */
  const sectorsBelowMean = [];

  for (const s of sectors) {
    const diff = s.density - meanDensity;
    varSum += diff * diff;
    if (s.density > meanDensity) sectorsAboveMean.push(s.name);
    else if (s.density < meanDensity) sectorsBelowMean.push(s.name);
  }

  const standardDeviation = Math.sqrt(varSum / n);
  const coefficientOfVariation =
    meanDensity > 0 ? standardDeviation / meanDensity : 0;
  const imbalanceScore =
    meanDensity > 0 ? (maxDensity - minDensity) / meanDensity : 0;

  return {
    meanDensity,
    minDensity: minDensity === Infinity ? 0 : minDensity,
    maxDensity: maxDensity === -Infinity ? 0 : maxDensity,
    standardDeviation,
    coefficientOfVariation,
    imbalanceScore,
    strongestSector: strongest,
    weakestSector: weakest,
    sectorsAboveMean,
    sectorsBelowMean,
  };
}

/**
 * Circular weighted mean angle and resultant length from angular bins.
 * Weights are bin densities. Resultant length ∈ [0, 1]; ~0 balanced, ~1 concentrated.
 *
 * Compass convention: 0° = North, clockwise.
 * Vector components: east = sin(θ), north = cos(θ).
 *
 * @param {AngularBin[]} angularProfile
 * @returns {{ weightedMeanAngle: number|null, directionalConcentration: number }}
 */
export function getDirectionalConcentration(angularProfile) {
  if (!Array.isArray(angularProfile)) {
    throw new TypeError('angularProfile must be an array');
  }

  let sumSin = 0;
  let sumCos = 0;
  let sumW = 0;

  for (const bin of angularProfile) {
    const w = bin.density;
    if (!(w > 0)) continue;
    const rad = (bin.angleCenter * Math.PI) / 180;
    sumSin += w * Math.sin(rad);
    sumCos += w * Math.cos(rad);
    sumW += w;
  }

  if (sumW <= 0) {
    return { weightedMeanAngle: null, directionalConcentration: 0 };
  }

  const meanSin = sumSin / sumW;
  const meanCos = sumCos / sumW;
  const resultant = Math.hypot(meanSin, meanCos);
  const directionalConcentration = Math.min(1, Math.max(0, resultant));

  let weightedMeanAngle = (Math.atan2(meanSin, meanCos) * 180) / Math.PI;
  if (weightedMeanAngle < 0) weightedMeanAngle += 360;

  return { weightedMeanAngle, directionalConcentration };
}

/**
 * Scan ImageData once and build the angular ink profile for the octagonal ring.
 * Does not modify imageData.
 *
 * @param {ImageData|{ data: Uint8ClampedArray|Uint8Array|ArrayLike<number>, width: number, height: number }} imageData
 * @param {Partial<OctagonGeometry>} geometry
 * @param {InkAnalysisOptions} [options]
 * @returns {AngularBin[]}
 */
export function getAngularProfile(imageData, geometry, options = {}) {
  validateImageData(imageData);
  const g = normalizeGeometry(geometry);

  const grayscaleThreshold =
    options.grayscaleThreshold ?? DEFAULT_GRAYSCALE_THRESHOLD;
  const alphaThreshold = options.alphaThreshold ?? DEFAULT_ALPHA_THRESHOLD;
  const binCount = options.binCount ?? DEFAULT_BIN_COUNT;
  const degreesPerBin = options.degreesPerBin ?? DEFAULT_DEGREES_PER_BIN;

  assertFiniteNumber(grayscaleThreshold, 'grayscaleThreshold');
  assertFiniteNumber(alphaThreshold, 'alphaThreshold');
  if (grayscaleThreshold < 0 || grayscaleThreshold > 255) {
    throw new RangeError('grayscaleThreshold must be in [0, 255]');
  }
  if (alphaThreshold < 0 || alphaThreshold > 255) {
    throw new RangeError('alphaThreshold must be in [0, 255]');
  }

  const bins = createAngularBins(binCount, degreesPerBin);
  const invBin = 1 / degreesPerBin;

  const outerVertices = getOctagonVertices(g, 'outer');
  const innerVertices = getOctagonVertices(g, 'inner');
  const bounds = verticesBounds(outerVertices);

  const imgW = imageData.width | 0;
  const imgH = imageData.height | 0;
  const data = imageData.data;

  const x0 = Math.max(0, Math.floor(bounds.minX));
  const y0 = Math.max(0, Math.floor(bounds.minY));
  const x1 = Math.min(imgW - 1, Math.ceil(bounds.maxX));
  const y1 = Math.min(imgH - 1, Math.ceil(bounds.maxY));

  if (x0 > x1 || y0 > y1) {
    return bins;
  }

  for (let y = y0; y <= y1; y++) {
    const row = y * imgW;
    for (let x = x0; x <= x1; x++) {
      const px = x + 0.5;
      const py = y + 0.5;

      if (!pointInPolygon(px, py, outerVertices)) continue;
      if (pointInPolygon(px, py, innerVertices)) continue;

      const i = (row + x) << 2;
      const a = data[i + 3];
      if (a < alphaThreshold) continue;

      const angle = pixelAngle(px, py, g.cx, g.cy);
      let binIndex = Math.floor(angle * invBin);
      if (binIndex >= binCount) binIndex = binCount - 1;
      if (binIndex < 0) binIndex = 0;

      const bin = bins[binIndex];
      bin.validPixels += 1;

      const r = data[i];
      const gCh = data[i + 1];
      const b = data[i + 2];
      if (luminance(r, gCh, b) <= grayscaleThreshold) {
        bin.inkPixels += 1;
      }
    }
  }

  for (const bin of bins) {
    bin.density = bin.validPixels > 0 ? bin.inkPixels / bin.validPixels : 0;
  }

  return bins;
}

/**
 * Full octagon ring ink analysis.
 * @param {ImageData|{ data: Uint8ClampedArray|Uint8Array|ArrayLike<number>, width: number, height: number }} imageData
 * @param {Partial<OctagonGeometry>} geometry
 * @param {InkAnalysisOptions} [options]
 * @returns {OctagonInkAnalysisResult}
 */
export function analyzeOctagonInk(imageData, geometry, options = {}) {
  const g = normalizeGeometry(geometry);
  const angularProfile = getAngularProfile(imageData, g, options);
  const sectors = getCompassSectors(angularProfile);
  const statistics = getInkStatistics(sectors);
  const { weightedMeanAngle, directionalConcentration } =
    getDirectionalConcentration(angularProfile);

  /** @type {CompassSector|null} */
  let strongestSector = null;
  /** @type {CompassSector|null} */
  let weakestSector = null;
  for (const s of sectors) {
    if (statistics.strongestSector === s.name) strongestSector = s;
    if (statistics.weakestSector === s.name) weakestSector = s;
  }

  return {
    geometry: { ...g },
    angularProfile,
    sectors,
    statistics,
    strongestSector,
    weakestSector,
    weightedMeanAngle,
    directionalConcentration,
  };
}

/**
 * Draw analysis geometry overlay on a CanvasRenderingContext2D.
 * Does not perform ink analysis.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {Partial<OctagonGeometry>} geometry
 * @param {{
 *   showOuter?: boolean,
 *   showInner?: boolean,
 *   showCenter?: boolean,
 *   showAxes?: boolean,
 *   showSectorBoundaries?: boolean,
 *   outerStrokeStyle?: string,
 *   innerStrokeStyle?: string,
 *   axisStrokeStyle?: string,
 *   sectorStrokeStyle?: string,
 *   centerFillStyle?: string,
 *   lineWidth?: number,
 *   axisLength?: number,
 *   labelAxes?: boolean,
 *   font?: string,
 * }} [options]
 */
export function drawOctagonAnalysisOverlay(ctx, geometry, options = {}) {
  if (!ctx || typeof ctx.beginPath !== 'function') {
    throw new TypeError('ctx must be a CanvasRenderingContext2D');
  }

  const g = normalizeGeometry(geometry);
  const showOuter = options.showOuter !== false;
  const showInner = options.showInner !== false;
  const showCenter = options.showCenter !== false;
  const showAxes = options.showAxes !== false;
  const showSectorBoundaries = options.showSectorBoundaries === true;
  const lineWidth = options.lineWidth ?? 1;
  const outerStroke = options.outerStrokeStyle ?? 'rgba(220, 40, 40, 0.95)';
  const innerStroke = options.innerStrokeStyle ?? 'rgba(40, 120, 220, 0.95)';
  const axisStroke = options.axisStrokeStyle ?? 'rgba(40, 40, 40, 0.7)';
  const sectorStroke = options.sectorStrokeStyle ?? 'rgba(40, 40, 40, 0.35)';
  const centerFill = options.centerFillStyle ?? 'rgba(220, 40, 40, 0.95)';
  const labelAxes = options.labelAxes !== false;
  const font = options.font ?? '12px sans-serif';

  const outer = getOctagonVertices(g, 'outer');
  const inner = getOctagonVertices(g, 'inner');
  const bounds = verticesBounds(outer);
  const radius =
    options.axisLength ??
    Math.max(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) * 0.55;

  ctx.save();
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';

  if (showOuter) {
    strokePolygon(ctx, outer, outerStroke);
  }
  if (showInner) {
    strokePolygon(ctx, inner, innerStroke);
  }

  if (showSectorBoundaries) {
    ctx.beginPath();
    ctx.strokeStyle = sectorStroke;
    for (const deg of [22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5]) {
      const p = pointFromCompassAngle(g.cx, g.cy, deg, radius);
      ctx.moveTo(g.cx, g.cy);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  if (showAxes) {
    ctx.beginPath();
    ctx.strokeStyle = axisStroke;
    for (const { center } of COMPASS_DEFS) {
      const p = pointFromCompassAngle(g.cx, g.cy, center, radius);
      ctx.moveTo(g.cx, g.cy);
      ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();

    if (labelAxes) {
      ctx.fillStyle = axisStroke;
      ctx.font = font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const { name, center } of COMPASS_DEFS) {
        const p = pointFromCompassAngle(g.cx, g.cy, center, radius * 1.08);
        ctx.fillText(name, p.x, p.y);
      }
    }
  }

  if (showCenter) {
    ctx.beginPath();
    ctx.fillStyle = centerFill;
    ctx.arc(g.cx, g.cy, Math.max(2, lineWidth * 2), 0, TWO_PI);
    ctx.fill();
  }

  ctx.restore();
}

/**
 * Default Type A geometry constants (not hard-coded into analysis scan logic).
 * @returns {Readonly<{ width: number, height: number, corner: number, innerInset: number }>}
 */
export function getDefaultTypeAGeometry() {
  return Object.freeze({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    corner: DEFAULT_CORNER,
    innerInset: DEFAULT_INNER_INSET,
  });
}

// --- internals ---

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {Float64Array} vertices
 * @param {string} strokeStyle
 */
function strokePolygon(ctx, vertices, strokeStyle) {
  ctx.beginPath();
  ctx.strokeStyle = strokeStyle;
  ctx.moveTo(vertices[0], vertices[1]);
  for (let i = 2; i < vertices.length; i += 2) {
    ctx.lineTo(vertices[i], vertices[i + 1]);
  }
  ctx.closePath();
  ctx.stroke();
}

/**
 * Point at compass angle (0° = North, clockwise) from center.
 * @param {number} cx
 * @param {number} cy
 * @param {number} degrees
 * @param {number} radius
 * @returns {{ x: number, y: number }}
 */
function pointFromCompassAngle(cx, cy, degrees, radius) {
  const rad = (degrees * Math.PI) / 180;
  return {
    x: cx + radius * Math.sin(rad),
    y: cy - radius * Math.cos(rad),
  };
}

/**
 * @param {unknown} imageData
 */
function validateImageData(imageData) {
  if (
    imageData == null ||
    typeof imageData !== 'object' ||
    /** @type {{ data?: unknown }} */ (imageData).data == null ||
    typeof /** @type {{ width?: unknown }} */ (imageData).width !== 'number' ||
    typeof /** @type {{ height?: unknown }} */ (imageData).height !== 'number'
  ) {
    throw new TypeError('imageData must provide data, width, and height');
  }
  const id = /** @type {{ data: { length: number }, width: number, height: number }} */ (
    imageData
  );
  if (id.width <= 0 || id.height <= 0) {
    throw new RangeError('imageData width and height must be > 0');
  }
  const expected = id.width * id.height * 4;
  if (id.data.length < expected) {
    throw new RangeError('imageData.data is shorter than width*height*4');
  }
}

/**
 * @param {unknown} value
 * @param {string} name
 */
function assertFiniteNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name} must be a finite number`);
  }
}

/**
 * @param {unknown} value
 * @param {string} name
 */
function assertPositiveInteger(value, name) {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive integer`);
  }
}
