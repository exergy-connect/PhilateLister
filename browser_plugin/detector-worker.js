const OPENCV_URL = "vendor/opencv.min.js";
const OPENCV_BASE = OPENCV_URL.replace(/[^/]+$/, "");
const INIT_TIMEOUT_MS = 90000;
const DEBUG = false;
let cvReadyPromise = null;
let cvInstance = null;
let readySent = false;

function dbg(...args) {
  if (!DEBUG) return;
  self.postMessage({ type: "debug", args });
}

function clamp01(n) {
  return Math.min(1, Math.max(0, Number(n)));
}

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, Number(n)));
}

function oddAtLeast(v, min) {
  let n = Math.max(min, Math.round(Number(v) || min));
  if (n % 2 === 0) n += 1;
  return n;
}

function iouBox(a, b) {
  const x1 = Math.max(a.x0, b.x0);
  const y1 = Math.max(a.y0, b.y0);
  const x2 = Math.min(a.x1, b.x1);
  const y2 = Math.min(a.y1, b.y1);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = (a.x1 - a.x0) * (a.y1 - a.y0);
  const areaB = (b.x1 - b.x0) * (b.y1 - b.y0);
  const u = areaA + areaB - inter;
  return u <= 0 ? 0 : inter / u;
}

function overlapArea(a, b) {
  const x1 = Math.max(a.x0, b.x0);
  const y1 = Math.max(a.y0, b.y0);
  const x2 = Math.min(a.x1, b.x1);
  const y2 = Math.min(a.y1, b.y1);
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

function ensureCvReady() {
  if (cvReadyPromise) return cvReadyPromise;
  cvReadyPromise = new Promise((resolve, reject) => {
    let done = false;
    let poll = null;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      if (poll) clearInterval(poll);
      reject(new Error("Timed out while initializing OpenCV.js in worker."));
    }, INIT_TIMEOUT_MS);
    const finish = (err, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (poll) clearInterval(poll);
      if (err) {
        reject(err);
        return;
      }
      // Never resolve a Promise with raw cv; some builds expose thenable-like cv objects.
      cvInstance = value || self.cv || null;
      resolve(true);
    };
    self.Module = {
      locateFile(path) {
        return OPENCV_BASE + path;
      },
      onRuntimeInitialized() {
        dbg("Worker onRuntimeInitialized fired");
        if (self.cv && self.cv.Mat) finish(null, self.cv);
      },
    };
    (async () => {
      try {
        // MV3 CSP blocks eval/new Function. importScripts loads the script without string-eval.
        dbg("Loading OpenCV.js via importScripts", OPENCV_URL);
        importScripts(OPENCV_URL);
        dbg("OpenCV.js loaded");
        poll = setInterval(() => {
          if (done) return;
          if (self.cv && self.cv.Mat) {
            dbg("cv.Mat available");
            finish(null, self.cv);
          }
        }, 120);
      } catch (e) {
        finish(e instanceof Error ? e : new Error(String(e)));
      }
    })();
  });
  return cvReadyPromise;
}

function notifyReady() {
  if (readySent) return;
  readySent = true;
  dbg("Worker ready signal");
  self.postMessage({ type: "ready" });
}

function normalizeTiltDeg(rawAngleDeg, rectW, rectH) {
  let angle = Number(rawAngleDeg) || 0;
  if (rectW < rectH) angle += 90;
  while (angle > 45) angle -= 90;
  while (angle < -45) angle += 90;
  return angle;
}

function detectBoxes(cv, width, height, rgbaBuffer, maxSide) {
  const t = {};
  const blurKernel = oddAtLeast(clamp(t.blurKernel ?? 5, 1, 31), 1);
  const threshBlock = oddAtLeast(clamp(t.threshBlock ?? 15, 3, 101), 3);
  const threshC = clamp(t.threshC ?? 4, -50, 50);
  const useWatershed = !!t.useWatershed;
  const closeKernel = oddAtLeast(clamp(t.closeKernel ?? 7, 1, 31), 1);
  const openKernel = oddAtLeast(clamp(t.openKernel ?? 7, 1, 31), 1);
  const peakThreshold = clamp(t.peakThreshold ?? 0.34, 0.05, 0.95);
  const minAreaRatio = clamp(t.minAreaRatio ?? 0.0015, 0.00005, 0.5);
  const minExtentT = clamp(t.minExtent ?? 0.25, 0.01, 1);
  const minArT = clamp(t.minAspectRatio ?? 0.5, 0.05, 20);
  const maxArT = clamp(t.maxAspectRatio ?? 2.0, minArT, 20);
  const iouThresholdT = clamp(t.iouThreshold ?? 0.35, 0.01, 0.95);
  const rgba = new Uint8ClampedArray(rgbaBuffer);
  const src = cv.matFromArray(height, width, cv.CV_8UC4, rgba);
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const w = Math.max(1, Math.round(width * scale));
  const h = Math.max(1, Math.round(height * scale));
  const scaled = new cv.Mat();
  const gray = new cv.Mat();
  const blurred = new cv.Mat();
  const bin = new cv.Mat();
  const dist = new cv.Mat();
  const distNorm = new cv.Mat();
  const sureFg = new cv.Mat();
  const sureFg8 = new cv.Mat();
  const sureBg = new cv.Mat();
  const unknown = new cv.Mat();
  const markers = new cv.Mat();
  const markersPlusOne = new cv.Mat();
  const markerOnes = new cv.Mat();
  const rgb = new cv.Mat();
  const closeK = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(closeKernel, closeKernel));
  const openK = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(openKernel, openKernel));
  const splitK = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(5, 5));
  const bgK = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
  try {
    cv.resize(src, scaled, new cv.Size(w, h), 0, 0, cv.INTER_AREA);
    cv.cvtColor(scaled, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, blurred, new cv.Size(blurKernel, blurKernel), 0);
    cv.adaptiveThreshold(
      blurred,
      bin,
      255,
      cv.ADAPTIVE_THRESH_GAUSSIAN_C,
      cv.THRESH_BINARY_INV,
      threshBlock,
      threshC
    );
    cv.morphologyEx(bin, bin, cv.MORPH_CLOSE, closeK);
    cv.morphologyEx(bin, bin, cv.MORPH_OPEN, openK);
    // Quick split pass: shrink connected blobs to break thin bridges.
    cv.erode(bin, bin, splitK, new cv.Point(-1, -1), 2);

    const imgArea = w * h;
    const minA = imgArea * minAreaRatio;
    const maxA = imgArea * 0.45;
    const minExtent = minExtentT;
    const maxRawCandidates = 1200;
    const maxNmsCandidates = 250;
    const maxOutputBoxes = 120;
    const raw = [];
    const maxAspectRatio = maxArT;
    const minAspectRatio = minArT;

    function pushCandidate(x0, y0, bw, bh, areaEstimate, tiltDeg) {
      const area = bw * bh;
      if (area < minA || area > maxA) return;
      const ar = bw / Math.max(1, bh);
      if (ar < minAspectRatio || ar > maxAspectRatio) return;
      const extent = areaEstimate / Math.max(1, area);
      if (extent < minExtent) return;
      // Filter long horizontal strips near the bottom edge that are not individual stamps.
      if (bw > w * 0.55 && bh < h * 0.18) return;
      const score = extent * 2.0 - Math.abs(Math.log(Math.max(0.2, Math.min(5, ar))));
      raw.push({ x0, y0, x1: x0 + bw, y1: y0 + bh, area, score, tiltDeg });
    }

    if (useWatershed) {
      // Watershed markers from distance-transform peaks.
      cv.distanceTransform(bin, dist, cv.DIST_L2, 5);
      cv.normalize(dist, distNorm, 0, 1.0, cv.NORM_MINMAX);
      cv.threshold(distNorm, sureFg, peakThreshold, 1.0, cv.THRESH_BINARY);
      sureFg.convertTo(sureFg8, cv.CV_8U, 255);
      cv.dilate(bin, sureBg, bgK);
      cv.subtract(sureBg, sureFg8, unknown);
      cv.connectedComponents(sureFg8, markers, 8, cv.CV_32S);

      markerOnes.create(markers.rows, markers.cols, cv.CV_32S);
      markerOnes.setTo(new cv.Scalar(1));
      cv.add(markers, markerOnes, markersPlusOne);
      markersPlusOne.copyTo(markers);
      markers.setTo(new cv.Scalar(0), unknown);

      cv.cvtColor(scaled, rgb, cv.COLOR_RGBA2RGB);
      cv.watershed(rgb, markers);

      const markerData = markers.data32S;
      const stats = new Map();
      for (let y = 0; y < h; y++) {
        const rowBase = y * w;
        for (let x = 0; x < w; x++) {
          const label = markerData[rowBase + x];
          if (label <= 1) continue;
          let s = stats.get(label);
          if (!s) {
            s = { minX: x, minY: y, maxX: x, maxY: y, count: 1 };
            stats.set(label, s);
          } else {
            if (x < s.minX) s.minX = x;
            if (y < s.minY) s.minY = y;
            if (x > s.maxX) s.maxX = x;
            if (y > s.maxY) s.maxY = y;
            s.count += 1;
          }
        }
      }

      for (const s of stats.values()) {
        const rw = s.maxX - s.minX + 1;
        const rh = s.maxY - s.minY + 1;
        pushCandidate(s.minX, s.minY, rw, rh, s.count, null);
        if (raw.length >= maxRawCandidates) break;
      }
    } else {
      // Default: contour-based box extraction.
      const contours = new cv.MatVector();
      const hierarchy = new cv.Mat();
      cv.findContours(bin, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      for (let i = 0; i < contours.size(); i++) {
        const c = contours.get(i);
        const contourArea = cv.contourArea(c, false);
        const r = cv.boundingRect(c);
        const rr = cv.minAreaRect(c);
        const tiltDeg = normalizeTiltDeg(
          rr && typeof rr.angle === "number" ? rr.angle : 0,
          rr && rr.size ? rr.size.width : r.width,
          rr && rr.size ? rr.size.height : r.height
        );
        c.delete();
        pushCandidate(r.x, r.y, r.width, r.height, contourArea, tiltDeg);
        if (raw.length >= maxRawCandidates) break;
      }
      contours.delete();
      hierarchy.delete();
    }

    raw.sort((a, b) => b.score - a.score || b.area - a.area);
    const nmsInput = raw.slice(0, maxNmsCandidates);
    const keep = [];
    const iouThresh = iouThresholdT;
    for (const b of nmsInput) {
      let skip = false;
      for (const k of keep) {
        if (iouBox(b, k) > iouThresh) {
          skip = true;
          break;
        }
      }
      if (!skip) {
        keep.push(b);
        if (keep.length >= maxOutputBoxes) break;
      }
    }

    // Keep boxes near the dominant size so results are roughly uniform.
    let filtered = keep;
    if (keep.length >= 4) {
      const sortedAreas = keep.map((b) => b.area).sort((a, b) => a - b);
      const mid = Math.floor(sortedAreas.length / 2);
      const medianArea =
        sortedAreas.length % 2 === 0
          ? (sortedAreas[mid - 1] + sortedAreas[mid]) / 2
          : sortedAreas[mid];
      const minConsistentArea = medianArea * 0.55;
      const maxConsistentArea = medianArea * 1.85;
      const consistent = keep.filter(
        (b) => b.area >= minConsistentArea && b.area <= maxConsistentArea
      );
      if (consistent.length >= Math.max(3, Math.floor(keep.length * 0.6))) {
        filtered = consistent;
      }
    }

    // Hard constraint: output must contain no overlapping boxes at all.
    const nonOverlapping = [];
    for (const b of filtered) {
      let conflicts = false;
      for (const k of nonOverlapping) {
        if (overlapArea(b, k) > 0) {
          conflicts = true;
          break;
        }
      }
      if (!conflicts) nonOverlapping.push(b);
    }

    let estimatedTiltDeg = 0;
    for (const b of nonOverlapping) {
      if (Number.isFinite(b.tiltDeg)) {
        estimatedTiltDeg = b.tiltDeg;
        break;
      }
    }

    return {
      boxes: nonOverlapping.map((b) => ({
        xMin: clamp01(b.x0 / w),
        xMax: clamp01(b.x1 / w),
        yMin: clamp01(b.y0 / h),
        yMax: clamp01(b.y1 / h),
      })),
      estimatedTiltDeg,
    };
  } finally {
    src.delete();
    scaled.delete();
    gray.delete();
    blurred.delete();
    bin.delete();
    dist.delete();
    distNorm.delete();
    sureFg.delete();
    sureFg8.delete();
    sureBg.delete();
    unknown.delete();
    markers.delete();
    markersPlusOne.delete();
    markerOnes.delete();
    rgb.delete();
    closeK.delete();
    openK.delete();
    splitK.delete();
    bgK.delete();
  }
}

self.onmessage = async (ev) => {
  const data = ev.data || {};
  const id = data.id;
  if (!id) return;
  try {
    await ensureCvReady();
    const cv = cvInstance || self.cv;
    if (!cv || !cv.Mat) throw new Error("OpenCV runtime initialized without usable cv API.");
    notifyReady();
    dbg("Detect request start", {
      width: data.width,
      height: data.height,
      maxSide: data.maxSide,
    });
    const result = detectBoxes(cv, data.width, data.height, data.rgbaBuffer, data.maxSide);
    const boxes = Array.isArray(result && result.boxes) ? result.boxes : [];
    const estimatedTiltDeg = Number(result && result.estimatedTiltDeg) || 0;
    dbg("Detect request complete", { boxes: boxes.length, estimatedTiltDeg });
    self.postMessage({ id, ok: true, boxes, estimatedTiltDeg });
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
};

// Warm up OpenCV immediately; main thread tracks readiness from this signal.
ensureCvReady().then(
  () => notifyReady(),
  (err) => {
    self.postMessage({
      type: "init_error",
      error: err instanceof Error ? err.message : String(err),
    });
  }
);
