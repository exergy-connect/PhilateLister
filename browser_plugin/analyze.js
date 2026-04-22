const form = document.getElementById("upload-form");
      const statusEl = document.getElementById("status");
      const submitBtn = document.getElementById("submit-btn");

      const WORKER_INIT_TIMEOUT_MS = 90000;
      const WORKER_DETECT_TIMEOUT_MS = 120000;
      const IS_FILE_ORIGIN = window.location.protocol === "file:";
      const DEBUG_LOGGING =
        new URLSearchParams(window.location.search).get("debug") === "1" ||
        window.localStorage.getItem("philatelister_debug") === "1";
      let detectorWorker = null;
      let detectorReqSeq = 0;
      const pendingDetections = new Map();
      let workerReadyPromise = null;
      let workerReadyTimer = null;
      let workerReadyResolve = null;
      let workerReadyReject = null;

      function dbg(...args) {
        if (!DEBUG_LOGGING) return;
        console.debug("[PhilateLister]", ...args);
      }

      function resetDetectorWorkerState() {
        if (detectorWorker) {
          detectorWorker.terminate();
          detectorWorker = null;
        }
        for (const [, req] of pendingDetections) {
          clearTimeout(req.timer);
          req.reject(new Error("Detection worker reset."));
        }
        pendingDetections.clear();
        workerReadyPromise = null;
        if (workerReadyTimer) {
          clearTimeout(workerReadyTimer);
          workerReadyTimer = null;
        }
        workerReadyResolve = null;
        workerReadyReject = null;
      }

      function ensureDetectorWorker() {
        if (IS_FILE_ORIGIN) {
          throw new Error(
            "This page is opened as file://. Web Worker + OpenCV needs http(s). Run a local server and open http://localhost instead."
          );
        }
        if (detectorWorker && workerReadyPromise) return detectorWorker;
        if (detectorWorker && !workerReadyPromise) {
          resetDetectorWorkerState();
        }
        dbg("Creating detection worker");
        try {
          const workerUrl =
            window.chrome && chrome.runtime && chrome.runtime.getURL
              ? chrome.runtime.getURL("detector-worker.js")
              : "detector-worker.js";
          detectorWorker = new Worker(workerUrl);
        } catch (err) {
          resetDetectorWorkerState();
          throw err instanceof Error ? err : new Error(String(err));
        }
        workerReadyPromise = new Promise((resolve, reject) => {
          workerReadyResolve = resolve;
          workerReadyReject = reject;
          workerReadyTimer = setTimeout(() => {
            workerReadyResolve = null;
            workerReadyReject = null;
            reject(new Error("Timed out while initializing OpenCV in worker."));
          }, WORKER_INIT_TIMEOUT_MS);
        });
        detectorWorker.onmessage = (ev) => {
          const data = ev.data || {};
          if (data.type === "debug") {
            dbg("Worker:", ...(Array.isArray(data.args) ? data.args : []));
            return;
          }
          if (data.type === "ready") {
            dbg("Worker ready acknowledged");
            if (workerReadyTimer) {
              clearTimeout(workerReadyTimer);
              workerReadyTimer = null;
            }
            if (workerReadyResolve) {
              workerReadyResolve();
              workerReadyResolve = null;
              workerReadyReject = null;
            }
            return;
          }
          if (data.type === "init_error") {
            const msg = data.error || "Worker OpenCV init failed.";
            dbg("Worker init error", msg);
            if (workerReadyTimer) {
              clearTimeout(workerReadyTimer);
              workerReadyTimer = null;
            }
            if (workerReadyReject) {
              workerReadyReject(new Error(msg));
              workerReadyResolve = null;
              workerReadyReject = null;
            }
            resetDetectorWorkerState();
            return;
          }
          const req = pendingDetections.get(data.id);
          if (!req) return;
          pendingDetections.delete(data.id);
          clearTimeout(req.timer);
          dbg("Worker response", {
            id: data.id,
            ok: !!data.ok,
            boxes: Array.isArray(data.boxes) ? data.boxes.length : undefined,
            estimatedTiltDeg: Number(data.estimatedTiltDeg) || 0,
          });
          if (data.ok) {
            req.resolve({
              boxes: Array.isArray(data.boxes) ? data.boxes : [],
              estimatedTiltDeg: Number(data.estimatedTiltDeg) || 0,
            });
          }
          else req.reject(new Error(data.error || "Worker detection failed."));
        };
        detectorWorker.onerror = (ev) => {
          dbg("Worker crashed", { message: ev.message, filename: ev.filename, lineno: ev.lineno, colno: ev.colno });
          resetDetectorWorkerState();
        };
        return detectorWorker;
      }

      function requestWorker(data, timeoutMs, timeoutMessage) {
        const worker = ensureDetectorWorker();
        const id = `worker_${Date.now()}_${++detectorReqSeq}`;
        const startedAt = performance.now();
        dbg("Worker request start", { id, cmd: data.cmd || "detect", timeoutMs });
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            pendingDetections.delete(id);
            dbg("Worker request timeout", { id, cmd: data.cmd || "detect", elapsedMs: Math.round(performance.now() - startedAt) });
            reject(new Error(timeoutMessage));
          }, timeoutMs);
          pendingDetections.set(id, {
            resolve: (value) => {
              dbg("Worker request done", { id, cmd: data.cmd || "detect", elapsedMs: Math.round(performance.now() - startedAt) });
              resolve(value);
            },
            reject: (err) => {
              dbg("Worker request failed", {
                id,
                cmd: data.cmd || "detect",
                elapsedMs: Math.round(performance.now() - startedAt),
                error: err instanceof Error ? err.message : String(err),
              });
              reject(err);
            },
            timer,
          });
          worker.postMessage({ ...data, id });
        });
      }

      function ensureDetectorWorkerReady() {
        dbg("Worker init requested");
        ensureDetectorWorker();
        if (!workerReadyPromise) {
          resetDetectorWorkerState();
          ensureDetectorWorker();
          if (!workerReadyPromise) {
            return Promise.reject(new Error("Worker initialization failed before readiness setup."));
          }
        }
        workerReadyPromise = workerReadyPromise
          .then(() => {
            dbg("Worker init ready");
            return undefined;
          })
          .catch((err) => {
            workerReadyPromise = null;
            dbg("Worker init failed", err instanceof Error ? err.message : String(err));
            throw err;
          });
        return workerReadyPromise;
      }

      function previewImageData(natW, natH) {
        opencvCanvas.width = natW;
        opencvCanvas.height = natH;
        const ctx2d = opencvCanvas.getContext("2d");
        if (!ctx2d) throw new Error("Canvas is not available in this browser.");
        ctx2d.drawImage(stampPreview, 0, 0, natW, natH);
        return ctx2d.getImageData(0, 0, natW, natH);
      }

      function rotateImageData(imageData, width, height, rotationDeg) {
        const srcCanvas = document.createElement("canvas");
        srcCanvas.width = width;
        srcCanvas.height = height;
        const srcCtx = srcCanvas.getContext("2d");
        if (!srcCtx) throw new Error("Canvas is not available in this browser.");
        srcCtx.putImageData(imageData, 0, 0);

        const dstCanvas = document.createElement("canvas");
        dstCanvas.width = width;
        dstCanvas.height = height;
        const dstCtx = dstCanvas.getContext("2d");
        if (!dstCtx) throw new Error("Canvas is not available in this browser.");
        dstCtx.fillStyle = "#ffffff";
        dstCtx.fillRect(0, 0, width, height);
        dstCtx.translate(width / 2, height / 2);
        dstCtx.rotate((rotationDeg * Math.PI) / 180);
        dstCtx.drawImage(srcCanvas, -width / 2, -height / 2, width, height);
        return dstCtx.getImageData(0, 0, width, height);
      }

      async function detectStampBoxesWithWorkerImageData(natW, natH, maxSide, imageData) {
        dbg("Detect request", { natW, natH, maxSide });
        await ensureDetectorWorkerReady();
        const worker = ensureDetectorWorker();
        const id = `detect_${Date.now()}_${++detectorReqSeq}`;
        return new Promise((resolve, reject) => {
          const timer = setTimeout(() => {
            pendingDetections.delete(id);
            reject(new Error("Detection timed out in worker."));
          }, WORKER_DETECT_TIMEOUT_MS);
          pendingDetections.set(id, { resolve, reject, timer });
          worker.postMessage(
            { id, cmd: "detect", width: natW, height: natH, maxSide, rgbaBuffer: imageData.data.buffer },
            [imageData.data.buffer]
          );
        });
      }

      window.addEventListener("beforeunload", () => {
        if (detectorWorker) {
          detectorWorker.terminate();
          detectorWorker = null;
        }
        workerReadyPromise = null;
        if (workerReadyTimer) {
          clearTimeout(workerReadyTimer);
          workerReadyTimer = null;
        }
        workerReadyResolve = null;
        workerReadyReject = null;
      });

      if (statusEl) {
        if (IS_FILE_ORIGIN) {
          statusEl.textContent =
            "Opened as file://. Start a local server (for example: python3 -m http.server 8000) and open http://localhost:8000/public/test/opencv_centering.html";
          statusEl.className = "error";
        } else {
          statusEl.textContent = "Starting worker OpenCV runtime…";
          statusEl.className = "";
        }
      }
      if (submitBtn) {
        submitBtn.disabled = IS_FILE_ORIGIN;
      }
      if (!IS_FILE_ORIGIN) {
        if (DEBUG_LOGGING) dbg("Debug logging enabled");
        ensureDetectorWorkerReady().then(
          () => {
            if (!statusEl) return;
            if (/Loading preview|Selected image|Analyzing centering/i.test(statusEl.textContent || "")) return;
            statusEl.textContent = "OpenCV worker ready";
            statusEl.className = "ok";
          },
          (err) => {
            if (!statusEl) return;
            statusEl.className = "error";
            statusEl.textContent = err instanceof Error ? err.message : String(err);
          }
        );
      }

      const stampFileInput = document.getElementById("stamp-file");
      const maxSideInput = document.getElementById("max-side");
      const imageResolutionEl = document.getElementById("image-resolution");
      const previewFrame = document.querySelector(".preview-frame");
      const stampPreview = document.getElementById("stamp-preview");
      const previewOverlay = document.getElementById("preview-overlay");
      const previewPlaceholder = document.getElementById("preview-placeholder");
      const opencvCanvas = document.getElementById("opencv-canvas");
      let previewObjectUrl = null;
      let previewBoxes = [];
      let previewLoadSeq = 0;
      let previewRotationDeg = 0;
      const urlParams = new URLSearchParams(window.location.search);

      function extensionStorageAvailable() {
        return !!(window.chrome && chrome.storage && chrome.storage.local && chrome.runtime);
      }

      function storageGet(key) {
        return new Promise((resolve, reject) => {
          chrome.storage.local.get(key, (items) => {
            const err = chrome.runtime && chrome.runtime.lastError;
            if (err) {
              reject(new Error(err.message || "Failed to read extension storage."));
              return;
            }
            resolve(items ? items[key] : undefined);
          });
        });
      }

      function storageRemove(key) {
        return new Promise((resolve, reject) => {
          chrome.storage.local.remove(key, () => {
            const err = chrome.runtime && chrome.runtime.lastError;
            if (err) {
              reject(new Error(err.message || "Failed to remove extension storage key."));
              return;
            }
            resolve();
          });
        });
      }

      function fileNameFromSourceUrl(sourceUrl) {
        try {
          const u = new URL(sourceUrl || "");
          const name = decodeURIComponent((u.pathname.split("/").pop() || "").trim());
          return name || "context-image.png";
        } catch (_) {
          return "context-image.png";
        }
      }

      async function dataUrlToFile(dataUrl, fallbackName) {
        const res = await fetch(dataUrl);
        if (!res.ok) {
          throw new Error(`Could not decode right-click image payload (HTTP ${res.status}).`);
        }
        const blob = await res.blob();
        const fileName = fallbackName || "context-image.png";
        return new File([blob], fileName, { type: blob.type || "image/png" });
      }

      async function loadImageFromExtensionContext() {
        const openError = urlParams.get("error");
        if (openError) {
          throw new Error(openError);
        }
        const imageKey = urlParams.get("imageKey");
        if (!imageKey) return;
        if (!extensionStorageAvailable()) {
          throw new Error("This analysis page is not running in a Chrome extension context.");
        }

        if (statusEl) {
          statusEl.className = "";
          statusEl.textContent = "Loading right-clicked image from extension storage…";
        }

        const payload = await storageGet(imageKey);
        await storageRemove(imageKey);
        if (!payload || !payload.dataUrl) {
          throw new Error("Right-click image was not found. Try the context menu action again.");
        }

        const file = await dataUrlToFile(payload.dataUrl, fileNameFromSourceUrl(payload.sourceUrl));
        const dt = new DataTransfer();
        dt.items.add(file);
        stampFileInput.files = dt.files;
        setPreviewBoxes([]);
        setStampPreview(file);
        submitBtn.disabled = false;

        await waitForImageReady(stampPreview);
        await nextFrame();
        form.requestSubmit();
      }

      function setPreviewRotation(deg) {
        previewRotationDeg = Number.isFinite(deg) ? deg : 0;
        stampPreview.style.transformOrigin = "50% 50%";
        stampPreview.style.transform = `rotate(${previewRotationDeg}deg)`;
      }

      function clamp01(n) {
        return Math.min(1, Math.max(0, Number(n)));
      }

      function isLikelyImageFile(file) {
        if (!file) return false;
        const mime = String(file.type || "").toLowerCase();
        if (mime.startsWith("image/")) return true;
        const name = String(file.name || "").toLowerCase();
        return /\.(jpg|jpeg|png|gif|webp|bmp|tif|tiff|heic|heif|avif|jfif)$/i.test(name);
      }

      function renderPreviewBoxes() {
        previewOverlay.innerHTML = "";
        if (stampPreview.hidden || !stampPreview.src || !previewFrame) return;
        if (!previewBoxes.length) return;

        const imgRect = stampPreview.getBoundingClientRect();
        const frameRect = previewFrame.getBoundingClientRect();
        if (!imgRect.width || !imgRect.height || !frameRect.width || !frameRect.height) return;

        const leftOffset = imgRect.left - frameRect.left;
        const topOffset = imgRect.top - frameRect.top;

        for (const { box, label } of previewBoxes) {
          const left = leftOffset + box.xMin * imgRect.width;
          const top = topOffset + box.yMin * imgRect.height;
          const width = (box.xMax - box.xMin) * imgRect.width;
          const height = (box.yMax - box.yMin) * imgRect.height;
          if (width < 1 || height < 1) continue;

          const boxEl = document.createElement("div");
          boxEl.className = "preview-bbox";
          boxEl.style.left = `${left}px`;
          boxEl.style.top = `${top}px`;
          boxEl.style.width = `${width}px`;
          boxEl.style.height = `${height}px`;
          const labelEl = document.createElement("span");
          labelEl.className = "preview-bbox-label";
          labelEl.textContent = label;
          boxEl.appendChild(labelEl);
          previewOverlay.appendChild(boxEl);
        }
      }

      function setPreviewBoxes(boxes) {
        previewBoxes = Array.isArray(boxes) ? boxes : [];
        renderPreviewBoxes();
      }

      function setStampPreview(file) {
        previewLoadSeq += 1;
        const seq = previewLoadSeq;
        if (previewObjectUrl) {
          URL.revokeObjectURL(previewObjectUrl);
          previewObjectUrl = null;
        }
        if (!file || !isLikelyImageFile(file)) {
          stampPreview.hidden = true;
          stampPreview.removeAttribute("src");
          setPreviewRotation(0);
          previewPlaceholder.hidden = false;
          setPreviewBoxes([]);
          if (imageResolutionEl) imageResolutionEl.textContent = "";
          if (file && statusEl) {
            statusEl.className = "error";
            statusEl.textContent = "Selected file does not look like a supported image.";
          }
          return;
        }
        previewObjectUrl = URL.createObjectURL(file);
        stampPreview.hidden = true;
        setPreviewRotation(0);
        previewPlaceholder.hidden = false;
        stampPreview.src = previewObjectUrl;
        if (statusEl && !/Analyzing centering/i.test(statusEl.textContent || "")) {
          statusEl.className = "";
          statusEl.textContent = `Loading preview: ${file.name}`;
        }
        const onLoad = () => {
          if (seq !== previewLoadSeq) return;
          stampPreview.hidden = false;
          previewPlaceholder.hidden = true;
          const natW = stampPreview.naturalWidth || 0;
          const natH = stampPreview.naturalHeight || 0;
          const longEdge = Math.max(natW, natH);
          if (imageResolutionEl) {
            imageResolutionEl.textContent = natW && natH ? `Resolution: ${natW} x ${natH}px` : "";
          }
          if (longEdge > 0) {
            maxSideInput.max = String(Math.max(400, longEdge));
            maxSideInput.value = String(Math.max(400, longEdge));
          }
          if (statusEl && !/Analyzing centering/i.test(statusEl.textContent || "")) {
            statusEl.className = "";
            statusEl.textContent = `Selected image: ${file.name}`;
          }
          renderPreviewBoxes();
        };
        const onError = () => {
          if (seq !== previewLoadSeq) return;
          stampPreview.hidden = true;
          stampPreview.removeAttribute("src");
          previewPlaceholder.hidden = false;
          setPreviewBoxes([]);
          if (imageResolutionEl) imageResolutionEl.textContent = "";
          if (statusEl) {
            statusEl.className = "error";
            statusEl.textContent = "Could not decode selected image for preview.";
          }
        };
        stampPreview.addEventListener("load", onLoad, { once: true });
        stampPreview.addEventListener("error", onError, { once: true });
      }

      stampFileInput.addEventListener("change", () => {
        setPreviewBoxes([]);
        setStampPreview(stampFileInput.files && stampFileInput.files[0] ? stampFileInput.files[0] : null);
      });
      stampPreview.addEventListener("load", () => {
        renderPreviewBoxes();
      });
      stampPreview.addEventListener("error", () => {
        stampPreview.hidden = true;
        setPreviewRotation(0);
        previewPlaceholder.hidden = false;
      });
      window.addEventListener("resize", renderPreviewBoxes);

      function nextFrame() {
        return new Promise((resolve) => {
          requestAnimationFrame(() => resolve());
        });
      }

      function waitForImageReady(imgEl) {
        if (imgEl.complete && imgEl.naturalWidth > 0) return Promise.resolve();
        return new Promise((resolve, reject) => {
          const onLoad = () => {
            cleanup();
            resolve();
          };
          const onError = () => {
            cleanup();
            reject(new Error("Could not decode the image."));
          };
          const cleanup = () => {
            imgEl.removeEventListener("load", onLoad);
            imgEl.removeEventListener("error", onError);
          };
          imgEl.addEventListener("load", onLoad, { once: true });
          imgEl.addEventListener("error", onError, { once: true });
          if (imgEl.complete && imgEl.naturalWidth > 0) {
            cleanup();
            resolve();
          }
        });
      }

      function choosePrimaryStampBox(boxes) {
        if (!Array.isArray(boxes) || !boxes.length) return null;
        let best = null;
        let bestScore = -Infinity;
        for (const box of boxes) {
          const w = Math.max(0, box.xMax - box.xMin);
          const h = Math.max(0, box.yMax - box.yMin);
          const area = w * h;
          if (area <= 0) continue;
          const cx = (box.xMin + box.xMax) / 2;
          const cy = (box.yMin + box.yMax) / 2;
          const centerDistance = Math.hypot(cx - 0.5, cy - 0.5);
          const score = area - centerDistance * 0.2;
          if (score > bestScore) {
            bestScore = score;
            best = box;
          }
        }
        return best;
      }

      function centeringGrade(scorePct) {
        if (scorePct >= 98) return "Superb";
        if (scorePct >= 95) return "Excellent";
        if (scorePct >= 90) return "Very Fine";
        if (scorePct >= 84) return "Fine";
        return "Off-center";
      }

      function centeringReportFromBox(box, imageW, imageH) {
        const left = clamp01(box.xMin);
        const right = clamp01(1 - box.xMax);
        const top = clamp01(box.yMin);
        const bottom = clamp01(1 - box.yMax);

        const horizontalScore = (Math.min(left, right) / Math.max(1e-9, Math.max(left, right))) * 100;
        const verticalScore = (Math.min(top, bottom) / Math.max(1e-9, Math.max(top, bottom))) * 100;
        const finalCenteringScore = Math.min(horizontalScore, verticalScore);

        return {
          type: "single_stamp_centering_analysis",
          image_size_px: { width: imageW, height: imageH },
          detected_stamp_box: {
            x_min: box.xMin,
            x_max: box.xMax,
            y_min: box.yMin,
            y_max: box.yMax,
            width_pct: (box.xMax - box.xMin) * 100,
            height_pct: (box.yMax - box.yMin) * 100,
          },
          border_margins_pct: {
            left: left * 100,
            right: right * 100,
            top: top * 100,
            bottom: bottom * 100,
          },
          centering: {
            horizontal_score_pct: horizontalScore,
            vertical_score_pct: verticalScore,
            final_centering_score_pct: finalCenteringScore,
            dead_centered: horizontalScore >= 99.999 && verticalScore >= 99.999,
            grade: centeringGrade(finalCenteringScore),
          },
          alignment: {
            estimated_tilt_deg_before_correction: 0,
            applied_rotation_deg: 0,
          },
        };
      }

      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        statusEl.textContent = "";
        statusEl.className = "";

        const file = stampFileInput.files && stampFileInput.files[0];
        if (!file) {
          statusEl.className = "error";
          statusEl.textContent = "Choose an image.";
          return;
        }

        const maxSideCeiling = Math.max(400, Number(maxSideInput.max) || 2400);
        const maxSide = Math.max(400, Math.min(maxSideCeiling, Number(maxSideInput.value) || 1200));
        submitBtn.disabled = true;
        statusEl.textContent = "Preparing worker…";

        try {
          await ensureDetectorWorkerReady();
          statusEl.textContent = "Analyzing centering in worker…";
          await nextFrame();

          await waitForImageReady(stampPreview);

          const natW = stampPreview.naturalWidth;
          const natH = stampPreview.naturalHeight;
          await nextFrame();
          const rawImageData = previewImageData(natW, natH);
          const firstPass = await detectStampBoxesWithWorkerImageData(natW, natH, maxSide, rawImageData);
          const estimatedTiltDeg = Number(firstPass.estimatedTiltDeg) || 0;
          const maxDeskewDeg = 12;
          const shouldDeskew = Math.abs(estimatedTiltDeg) >= 0.2 && Math.abs(estimatedTiltDeg) <= maxDeskewDeg;
          const appliedRotationDeg = shouldDeskew ? -estimatedTiltDeg : 0;

          let secondInput = previewImageData(natW, natH);
          if (appliedRotationDeg !== 0) {
            secondInput = rotateImageData(secondInput, natW, natH, appliedRotationDeg);
          }
          const secondPass = await detectStampBoxesWithWorkerImageData(
            natW,
            natH,
            maxSide,
            secondInput
          );
          const stampBox = choosePrimaryStampBox(secondPass.boxes);
          if (!stampBox) {
            throw new Error("Could not detect a clear stamp boundary. Try a tighter crop with clear stamp edges.");
          }

          const previewList = [];
          const report = centeringReportFromBox(stampBox, natW, natH);
          report.alignment.estimated_tilt_deg_before_correction = estimatedTiltDeg;
          report.alignment.applied_rotation_deg = appliedRotationDeg;
          setPreviewRotation(appliedRotationDeg);
          const jsonStr = JSON.stringify(report, null, 2);

          const section = document.getElementById("listing-section");
          const waitEl = document.getElementById("listing-wait");
          const scrollEl = document.getElementById("listing-scroll");
          const textEl = document.getElementById("listing-text");
          const uploadLayout = document.getElementById("upload-layout");
          section.hidden = false;
          if (uploadLayout) uploadLayout.classList.add("listing-open");
          document.querySelector("main")?.classList.add("listing-open");
          // Layout width changes when listing panel opens; render boxes after reflow.
          setPreviewBoxes(previewList);
          await nextFrame();
          renderPreviewBoxes();
          section.setAttribute("aria-busy", "false");
          waitEl.textContent =
            appliedRotationDeg !== 0
              ? `Applied deskew rotation of ${appliedRotationDeg.toFixed(2)}° before centering analysis.`
              : "No deskew rotation applied; image already near level.";
          textEl.textContent = jsonStr;
          scrollEl.hidden = false;

          statusEl.className = "ok";
          statusEl.textContent = `Centering analysis complete. Grade: ${report.centering.grade} (${report.centering.final_centering_score_pct.toFixed(1)}%).`;
        } catch (err) {
          statusEl.className = "error";
          statusEl.textContent = err instanceof Error ? err.message : String(err);
        } finally {
          submitBtn.disabled = false;
        }
      });

      loadImageFromExtensionContext().catch((err) => {
        if (!statusEl) return;
        statusEl.className = "error";
        statusEl.textContent = err instanceof Error ? err.message : String(err);
      });
