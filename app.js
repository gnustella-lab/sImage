(() => {
  "use strict";

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  const elements = {
    fileInput: $("#fileInput"),
    dropzone: $("#dropzone"),
    editor: $("#editor"),
    studio: $("#studio"),
    fileName: $("#fileName"),
    fileDetails: $("#fileDetails"),
    previewCanvas: $("#previewCanvas"),
    canvasStage: $("#canvasStage"),
    canvasLabel: $("#canvasLabel"),
    canvasHelp: $("#canvasHelp"),
    metadataSummary: $("#metadataSummary"),
    metadataMeter: $("#metadataMeter"),
    metadataBlocks: $("#metadataBlocks"),
    metadataSize: $("#metadataSize"),
    outputWidth: $("#outputWidth"),
    outputHeight: $("#outputHeight"),
    lockRatio: $("#lockRatio"),
    outputFormat: $("#outputFormat"),
    outputQuality: $("#outputQuality"),
    qualityOutput: $("#qualityOutput"),
    qualityControl: $("#qualityControl"),
    redactionStrength: $("#redactionStrength"),
    strengthOutput: $("#strengthOutput"),
    strengthControl: $("#strengthControl"),
    undoRedaction: $("#undoRedaction"),
    clearRedactions: $("#clearRedactions"),
    privateFilename: $("#privateFilename"),
    compareButton: $("#compareButton"),
    downloadButton: $("#downloadButton"),
    exportStatus: $("#exportStatus"),
    outputEstimate: $("#outputEstimate"),
    toast: $("#toast"),
    menuToggle: $("#menuToggle"),
    mainNav: $("#mainNav")
  };

  const SUPPORTED_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/bmp"
  ]);

  const state = {
    file: null,
    image: null,
    sourceUrl: null,
    originalWidth: 0,
    originalHeight: 0,
    aspectRatio: 1,
    metadata: { count: 0, bytes: 0, labels: [] },
    activePanel: "privacy",
    redactionMode: "pixelate",
    redactions: [],
    drawing: false,
    selection: null,
    comparing: false,
    exportInProgress: false,
    resizeFrame: null
  };

  const canvasContext = elements.previewCanvas.getContext("2d", { alpha: true });
  let toastTimer = null;

  function init() {
    initNavigation();
    initRevealAnimations();
    initUploader();
    initToolPanels();
    initRedactionControls();
    initAdjustmentControls();
    initCanvasInteractions();
    initExportControls();
    initZoomControls();
    initCanvasRedactToolbar();
    updateRange(elements.outputQuality, elements.qualityControl);
    updateRange(elements.redactionStrength, elements.strengthControl);
    $("#currentYear").textContent = new Date().getFullYear();

    if ("serviceWorker" in navigator && /^https?:$/.test(location.protocol)) {
      navigator.serviceWorker.register("./sw.js").catch(() => {
        // The editor remains fully functional even when offline caching is unavailable.
      });
    }
  }

  function initNavigation() {
    elements.menuToggle.addEventListener("click", () => {
      const open = elements.menuToggle.getAttribute("aria-expanded") === "true";
      elements.menuToggle.setAttribute("aria-expanded", String(!open));
      elements.mainNav.classList.toggle("open", !open);
    });

    $$("#mainNav a").forEach((link) => {
      link.addEventListener("click", () => {
        elements.menuToggle.setAttribute("aria-expanded", "false");
        elements.mainNav.classList.remove("open");
      });
    });
  }

  function initRevealAnimations() {
    const items = $$(".reveal");
    if (!("IntersectionObserver" in window) || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      items.forEach((item) => item.classList.add("visible"));
      return;
    }

    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.11 });

    items.forEach((item) => observer.observe(item));
  }

  function initUploader() {
    $$('[data-open-file]').forEach((button) => {
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        elements.fileInput.click();
      });
    });

    elements.fileInput.addEventListener("change", () => {
      const [file] = elements.fileInput.files;
      if (file) loadImageFile(file);
    });

    elements.dropzone.addEventListener("click", () => elements.fileInput.click());
    elements.dropzone.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        elements.fileInput.click();
      }
    });

    ["dragenter", "dragover"].forEach((eventName) => {
      elements.dropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        elements.dropzone.classList.add("dragging");
      });
    });

    ["dragleave", "drop"].forEach((eventName) => {
      elements.dropzone.addEventListener(eventName, (event) => {
        event.preventDefault();
        elements.dropzone.classList.remove("dragging");
      });
    });

    elements.dropzone.addEventListener("drop", (event) => {
      const [file] = event.dataTransfer.files;
      if (file) loadImageFile(file);
    });

    $("#closeImage").addEventListener("click", closeImage);
    $("#changeImage").addEventListener("click", () => elements.fileInput.click());
  }

  async function loadImageFile(file) {
    if (!SUPPORTED_TYPES.has(file.type)) {
      showToast("Unsupported format. Use JPEG, PNG, WebP, GIF, or BMP.", true);
      return;
    }

    if (file.size > 40 * 1024 * 1024) {
      showToast("Large file: processing may use significant memory.");
    }

    setExportStatus("Reading image locally", "The file stays on your device");

    try {
      const [image, buffer] = await Promise.all([
        createImageFromFile(file),
        file.arrayBuffer()
      ]);

      releaseSourceUrl();
      state.file = file;
      state.image = image;
      state.sourceUrl = image.dataset.objectUrl || null;
      state.originalWidth = image.naturalWidth;
      state.originalHeight = image.naturalHeight;
      state.aspectRatio = image.naturalWidth / image.naturalHeight;
      state.metadata = scanMetadata(buffer, file.type);
      state.redactions = [];
      state.selection = null;
      state.drawing = false;

      elements.fileName.textContent = file.name;
      elements.fileDetails.textContent = `${formatNumber(image.naturalWidth)} × ${formatNumber(image.naturalHeight)} • ${formatBytes(file.size)}`;
      elements.outputWidth.value = image.naturalWidth;
      elements.outputHeight.value = image.naturalHeight;
      elements.outputFormat.value = preferredOutputFormat(file.type);
      elements.outputQuality.value = "86";
      elements.qualityOutput.textContent = "86%";
      elements.privateFilename.checked = true;
      elements.fileInput.value = "";

      updateMetadataReport();
      updateQualityState();
      updateRedactionButtons();
      updatePresetButtons("original");
      updateRange(elements.outputQuality, elements.qualityControl);
      switchPanel("privacy");

      elements.dropzone.hidden = true;
      elements.editor.hidden = false;
      renderPreview();
      setExportStatus("Ready to protect", `${formatNumber(image.naturalWidth)} × ${formatNumber(image.naturalHeight)} pixels`);

      requestAnimationFrame(() => {
        elements.studio.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch (error) {
      console.error(error);
      setExportStatus("Could not open the image", "Try another supported file");
      showToast("Could not read this image.", true);
    }
  }

  function createImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const url = URL.createObjectURL(file);
      image.decoding = "async";
      image.onload = () => {
        image.dataset.objectUrl = url;
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Could not decode the image"));
      };
      image.src = url;
    });
  }

  function closeImage() {
    releaseSourceUrl();
    state.file = null;
    state.image = null;
    state.redactions = [];
    state.selection = null;
    elements.editor.hidden = true;
    elements.dropzone.hidden = false;
    elements.fileInput.value = "";
    canvasContext.clearRect(0, 0, elements.previewCanvas.width, elements.previewCanvas.height);
    setExportStatus("Ready to protect", "File size will appear after export");
  }

  function releaseSourceUrl() {
    if (state.sourceUrl) {
      URL.revokeObjectURL(state.sourceUrl);
      state.sourceUrl = null;
    }
  }

  function initToolPanels() {
    $$(".tool-tab").forEach((button) => {
      button.addEventListener("click", () => switchPanel(button.dataset.panel));
    });
    $$('[data-go-panel]').forEach((button) => {
      button.addEventListener("click", () => switchPanel(button.dataset.goPanel));
    });
  }

  function switchPanel(panelName) {
    state.activePanel = panelName;
    const panelOrder = ["privacy", "redact", "adjust"];
    const activeIndex = panelOrder.indexOf(panelName);

    const workflowBar = document.querySelector('.workflow-bar');
    if (workflowBar) workflowBar.dataset.step = String(activeIndex + 1);

    $$(".tool-tab").forEach((button) => {
      const active = button.dataset.panel === panelName;
      button.classList.toggle("active", active);
      button.classList.toggle("completed", panelOrder.indexOf(button.dataset.panel) < activeIndex);
      button.setAttribute("aria-pressed", String(active));
      if (active) button.setAttribute("aria-current", "step");
      else button.removeAttribute("aria-current");
    });
    $$("[data-tool-panel]").forEach((panel) => {
      const active = panel.dataset.toolPanel === panelName;
      panel.classList.toggle("active", active);
      panel.hidden = !active;
    });

    const redacting = panelName === "redact";
    elements.canvasStage.classList.toggle("redacting", redacting);
    elements.canvasHelp.textContent = redacting
      ? "Drag over the image to hide a sensitive area."
      : "The preview represents the new copy with metadata removed.";

    const redactToolbar = document.getElementById('canvasRedactToolbar');
    if (redactToolbar) redactToolbar.hidden = !redacting;

    renderPreview();
  }

  function initRedactionControls() {
    $$('[data-redaction]').forEach((button) => {
      button.addEventListener('click', () => {
        state.redactionMode = button.dataset.redaction;
        $$('[data-redaction]').forEach((choice) => {
          const active = choice === button;
          choice.classList.toggle('active', active);
          choice.setAttribute('aria-pressed', String(active));
        });
        // Sync canvas toolbar buttons
        $$('[data-canvas-redaction]').forEach((choice) => {
          choice.classList.toggle('active', choice.dataset.canvasRedaction === button.dataset.redaction);
        });
      });
    });

    elements.redactionStrength.addEventListener("input", () => {
      elements.strengthOutput.textContent = elements.redactionStrength.value;
      updateRange(elements.redactionStrength, elements.strengthControl);
    });

    elements.undoRedaction.addEventListener("click", () => {
      state.redactions.pop();
      updateRedactionButtons();
      renderPreview();
      showToast("Last hidden area removed.");
    });

    elements.clearRedactions.addEventListener("click", () => {
      state.redactions = [];
      updateRedactionButtons();
      renderPreview();
      showToast("All hidden areas removed.");
    });
  }

  function initCanvasInteractions() {
    const canvas = elements.previewCanvas;

    canvas.addEventListener("pointerdown", (event) => {
      if (!state.image || state.activePanel !== "redact" || state.comparing) return;
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      const point = getCanvasPoint(event);
      state.drawing = true;
      state.selection = { startX: point.x, startY: point.y, endX: point.x, endY: point.y };
      renderPreview();
    });

    canvas.addEventListener("pointermove", (event) => {
      if (!state.drawing || !state.selection) return;
      event.preventDefault();
      const point = getCanvasPoint(event);
      state.selection.endX = point.x;
      state.selection.endY = point.y;
      renderPreview();
    });

    const finishDrawing = (event) => {
      if (!state.drawing || !state.selection) return;
      if (event && canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);

      const rectangle = normalizeSelection(state.selection);
      state.drawing = false;
      state.selection = null;

      if (rectangle.width > 0.008 && rectangle.height > 0.008) {
        state.redactions.push({
          ...rectangle,
          mode: state.redactionMode,
          strength: Number(elements.redactionStrength.value)
        });
        updateRedactionButtons();
        showToast("Hidden area added.");
      }
      renderPreview();
    };

    canvas.addEventListener("pointerup", finishDrawing);
    canvas.addEventListener("pointercancel", finishDrawing);

    const startCompare = (event) => {
      if (!state.image) return;
      event.preventDefault();
      state.comparing = true;
      elements.compareButton.classList.add("comparing");
      elements.canvasLabel.textContent = "ORIGINAL PREVIEW";
      renderPreview(true);
    };

    const endCompare = () => {
      if (!state.comparing) return;
      state.comparing = false;
      elements.compareButton.classList.remove("comparing");
      elements.canvasLabel.textContent = "PROTECTED PREVIEW";
      renderPreview(false);
    };

    elements.compareButton.addEventListener("pointerdown", startCompare);
    window.addEventListener("pointerup", endCompare);
    elements.compareButton.addEventListener("keydown", (event) => {
      if ((event.key === " " || event.key === "Enter") && !event.repeat) startCompare(event);
    });
    elements.compareButton.addEventListener("keyup", (event) => {
      if (event.key === " " || event.key === "Enter") endCompare();
    });

    window.addEventListener("resize", () => {
      if (!state.image) return;
      cancelAnimationFrame(state.resizeFrame);
      state.resizeFrame = requestAnimationFrame(() => renderPreview(state.comparing));
    });
  }

  function getCanvasPoint(event) {
    const rect = elements.previewCanvas.getBoundingClientRect();
    return {
      x: clamp((event.clientX - rect.left) / rect.width, 0, 1),
      y: clamp((event.clientY - rect.top) / rect.height, 0, 1)
    };
  }

  function normalizeSelection(selection) {
    const x = Math.min(selection.startX, selection.endX);
    const y = Math.min(selection.startY, selection.endY);
    return {
      x,
      y,
      width: Math.abs(selection.endX - selection.startX),
      height: Math.abs(selection.endY - selection.startY)
    };
  }

  function updateRedactionButtons() {
    const hasRedactions = state.redactions.length > 0;
    elements.undoRedaction.disabled = !hasRedactions;
    elements.clearRedactions.disabled = !hasRedactions;
    const canvasUndoBtn = document.getElementById('canvasUndoBtn');
    if (canvasUndoBtn) canvasUndoBtn.disabled = !hasRedactions;
    if (state.image) {
      const suffix = hasRedactions
        ? `${state.redactions.length} ${state.redactions.length === 1 ? "hidden area" : "hidden areas"}`
        : "No visual areas hidden";
      setExportStatus("Ready to protect", suffix);
    }
  }

  function initAdjustmentControls() {
    elements.outputWidth.addEventListener("input", () => updateDimensions("width"));
    elements.outputHeight.addEventListener("input", () => updateDimensions("height"));

    elements.outputFormat.addEventListener("change", () => {
      updateQualityState();
      renderPreview();
    });

    elements.outputQuality.addEventListener("input", () => {
      elements.qualityOutput.textContent = `${elements.outputQuality.value}%`;
      updateRange(elements.outputQuality, elements.qualityControl);
      setExportStatus("Ready to protect", `Output quality: ${elements.outputQuality.value}%`);
    });

    $("#resetAdjustments").addEventListener("click", () => {
      if (!state.image) return;
      elements.outputWidth.value = state.originalWidth;
      elements.outputHeight.value = state.originalHeight;
      elements.outputQuality.value = "86";
      elements.qualityOutput.textContent = "86%";
      elements.outputFormat.value = preferredOutputFormat(state.file.type);
      updateRange(elements.outputQuality, elements.qualityControl);
      updateQualityState();
      renderPreview();
      updatePresetButtons("original");
      showToast("Original settings restored.");
    });

    $$('[data-size-preset]').forEach((button) => {
      button.addEventListener("click", () => applySizePreset(button.dataset.sizePreset));
    });
  }

  function updateDimensions(changed) {
    if (!state.image) return;
    let width = parseInteger(elements.outputWidth.value);
    let height = parseInteger(elements.outputHeight.value);

    if (elements.lockRatio.checked) {
      if (changed === "width" && width) {
        height = Math.max(1, Math.round(width / state.aspectRatio));
        elements.outputHeight.value = height;
      } else if (changed === "height" && height) {
        width = Math.max(1, Math.round(height * state.aspectRatio));
        elements.outputWidth.value = width;
      }
    }

    if (width && height) {
      updatePresetButtons();
      setExportStatus("Ready to protect", `${formatNumber(width)} × ${formatNumber(height)} pixels`);
      renderPreview();
    }
  }

  function applySizePreset(preset) {
    if (!state.image) return;
    const width = preset === "original"
      ? state.originalWidth
      : Math.min(state.originalWidth, Number(preset));
    elements.outputWidth.value = width;
    elements.outputHeight.value = Math.max(1, Math.round(width / state.aspectRatio));
    updatePresetButtons(preset);
    setExportStatus("Ready to protect", `${formatNumber(width)} × ${formatNumber(elements.outputHeight.value)} pixels`);
    renderPreview();
  }

  function updatePresetButtons(activePreset = null) {
    $$('[data-size-preset]').forEach((button) => {
      const target = button.dataset.sizePreset === "original"
        ? state.originalWidth
        : Math.min(state.originalWidth, Number(button.dataset.sizePreset));
      button.classList.toggle("active", activePreset === button.dataset.sizePreset || Number(elements.outputWidth.value) === target);
    });
  }

  function updateQualityState() {
    const isPng = elements.outputFormat.value === "image/png";
    elements.qualityControl.classList.toggle("quality-disabled", isPng);
    elements.outputQuality.disabled = isPng;
  }

  function updateRange(input, wrapper) {
    const min = Number(input.min);
    const max = Number(input.max);
    const progress = ((Number(input.value) - min) / (max - min)) * 100;
    wrapper.style.setProperty("--range-progress", `${progress}%`);
  }

  function renderPreview(showOriginal = false) {
    if (!state.image) return;
    const output = getOutputDimensions(false);
    if (!output) return;

    const stageWidth = Math.max(220, elements.canvasStage.clientWidth - 56);
    const maximumWidth = Math.min(1000, stageWidth);
    const maximumHeight = window.innerWidth <= 660 ? 370 : 490;
    const fit = Math.min(maximumWidth / output.width, maximumHeight / output.height, 1);
    const cssWidth = Math.max(1, Math.round(output.width * fit));
    const cssHeight = Math.max(1, Math.round(output.height * fit));
    const ratio = Math.min(window.devicePixelRatio || 1, 2);

    elements.previewCanvas.width = Math.max(1, Math.round(cssWidth * ratio));
    elements.previewCanvas.height = Math.max(1, Math.round(cssHeight * ratio));
    elements.previewCanvas.style.width = `${cssWidth}px`;
    elements.previewCanvas.style.height = `${cssHeight}px`;

    drawResult(canvasContext, elements.previewCanvas.width, elements.previewCanvas.height, showOriginal);

    if (!showOriginal && state.selection) {
      drawSelection(canvasContext, elements.previewCanvas.width, elements.previewCanvas.height, normalizeSelection(state.selection));
    }
  }

  function drawResult(context, width, height, showOriginal = false) {
    context.save();
    context.clearRect(0, 0, width, height);
    if (elements.outputFormat.value === "image/jpeg") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
    }
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(state.image, 0, 0, width, height);
    context.restore();

    if (!showOriginal) applyRedactions(context, width, height);
  }

  function applyRedactions(context, width, height) {
    state.redactions.forEach((redaction) => {
      const x = Math.round(redaction.x * width);
      const y = Math.round(redaction.y * height);
      const areaWidth = Math.max(1, Math.round(redaction.width * width));
      const areaHeight = Math.max(1, Math.round(redaction.height * height));

      if (redaction.mode === "bar") {
        context.save();
        context.fillStyle = "#050505";
        context.fillRect(x, y, areaWidth, areaHeight);
        context.restore();
      } else if (redaction.mode === "blur") {
        applyBlur(context, x, y, areaWidth, areaHeight, redaction.strength);
      } else {
        applyPixelation(context, x, y, areaWidth, areaHeight, redaction.strength);
      }
    });
  }

  function applyPixelation(context, x, y, width, height, strength) {
    const block = Math.max(4, Math.round(Math.min(context.canvas.width, context.canvas.height) * (strength / 1700)));
    const miniWidth = Math.max(1, Math.ceil(width / block));
    const miniHeight = Math.max(1, Math.ceil(height / block));
    const temporary = document.createElement("canvas");
    temporary.width = miniWidth;
    temporary.height = miniHeight;
    const temporaryContext = temporary.getContext("2d");
    temporaryContext.imageSmoothingEnabled = false;
    temporaryContext.drawImage(context.canvas, x, y, width, height, 0, 0, miniWidth, miniHeight);

    context.save();
    context.imageSmoothingEnabled = false;
    context.drawImage(temporary, 0, 0, miniWidth, miniHeight, x, y, width, height);
    context.restore();
  }

  function applyBlur(context, x, y, width, height, strength) {
    const radius = clamp(Math.round(Math.min(width, height) * (strength / 650)), 3, 60);
    const padding = radius * 2;
    const sourceX = Math.max(0, x - padding);
    const sourceY = Math.max(0, y - padding);
    const sourceRight = Math.min(context.canvas.width, x + width + padding);
    const sourceBottom = Math.min(context.canvas.height, y + height + padding);
    const sourceWidth = sourceRight - sourceX;
    const sourceHeight = sourceBottom - sourceY;
    const temporary = document.createElement("canvas");
    temporary.width = Math.max(1, sourceWidth);
    temporary.height = Math.max(1, sourceHeight);
    temporary.getContext("2d").drawImage(context.canvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, sourceWidth, sourceHeight);

    context.save();
    context.beginPath();
    context.rect(x, y, width, height);
    context.clip();
    context.filter = `blur(${radius}px)`;
    context.drawImage(temporary, sourceX, sourceY);
    context.restore();
  }

  function drawSelection(context, width, height, selection) {
    context.save();
    context.strokeStyle = "#ffd60a";
    context.lineWidth = Math.max(2, width / 420);
    context.setLineDash([8, 5]);
    context.fillStyle = "rgba(255, 214, 10, 0.12)";
    context.fillRect(selection.x * width, selection.y * height, selection.width * width, selection.height * height);
    context.strokeRect(selection.x * width, selection.y * height, selection.width * width, selection.height * height);
    context.restore();
  }

  function initExportControls() {
    elements.downloadButton.addEventListener("click", exportImage);
    $$('[data-export-image]').forEach((button) => button.addEventListener("click", exportImage));
  }

  function initZoomControls() {
    const zoomIn = document.getElementById('zoomIn');
    const zoomOut = document.getElementById('zoomOut');
    if (zoomIn && zoomOut) {
      zoomIn.addEventListener('click', () => showToast('Preview always fits to available space.'));
      zoomOut.addEventListener('click', () => showToast('Preview always fits to available space.'));
    }
  }

  function initCanvasRedactToolbar() {
    $$('[data-canvas-redaction]').forEach((button) => {
      button.addEventListener('click', () => {
        state.redactionMode = button.dataset.canvasRedaction;
        $$('[data-canvas-redaction]').forEach((choice) => {
          choice.classList.toggle('active', choice === button);
        });
        // Sync sidebar buttons
        $$('[data-redaction]').forEach((choice) => {
          const active = choice.dataset.redaction === button.dataset.canvasRedaction;
          choice.classList.toggle('active', active);
          choice.setAttribute('aria-pressed', String(active));
        });
      });
    });

    const canvasUndoBtn = document.getElementById('canvasUndoBtn');
    if (canvasUndoBtn) {
      canvasUndoBtn.addEventListener('click', () => {
        state.redactions.pop();
        updateRedactionButtons();
        renderPreview();
        showToast('Last hidden area removed.');
      });
    }
  }

  async function exportImage() {
    if (!state.image || state.exportInProgress) return;
    const output = getOutputDimensions(true);
    if (!output) return;

    state.exportInProgress = true;
    elements.downloadButton.disabled = true;
    elements.downloadButton.textContent = "Creating clean copy...";
    setExportStatus("Protecting image", "Re-encoding pixels and discarding metadata");

    await new Promise((resolve) => requestAnimationFrame(resolve));

    try {
      const exportCanvas = document.createElement("canvas");
      exportCanvas.width = output.width;
      exportCanvas.height = output.height;
      const exportContext = exportCanvas.getContext("2d", { alpha: true });
      drawResult(exportContext, output.width, output.height, false);

      const requestedType = elements.outputFormat.value;
      const quality = Number(elements.outputQuality.value) / 100;
      let blob = await canvasToBlob(exportCanvas, requestedType, quality);
      if (!blob) throw new Error("The browser could not create the file");

      let actualType = blob.type || requestedType;
      if (!SUPPORTED_OUTPUT_TYPES.has(actualType)) {
        blob = await canvasToBlob(exportCanvas, "image/png", 1);
        actualType = "image/png";
      }

      blob = await sanitizeEncodedBlob(blob, actualType);
      const verification = scanMetadata(await blob.arrayBuffer(), actualType);
      if (verification.count > 0) {
        throw new Error("Local verification found metadata in the output");
      }

      const filename = createOutputFilename(actualType);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 15000);

      const comparison = blob.size < state.file.size
        ? `${Math.round((1 - blob.size / state.file.size) * 100)}% smaller than the original`
        : "new copy re-encoded without metadata";
      setExportStatus("Protected copy downloaded", `${formatBytes(blob.size)} • ${comparison}`);
      showToast("Image protected and verified. Download started.");
    } catch (error) {
      console.error(error);
      setExportStatus("Export failed", "Reduce the dimensions and try again");
      showToast(error.message || "Could not export the image.", true);
    } finally {
      state.exportInProgress = false;
      elements.downloadButton.disabled = false;
      elements.downloadButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0 4-4m-4 4-4-4"></path><path d="M5 19h14"></path></svg> Download protected image';
    }
  }

  const SUPPORTED_OUTPUT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  }

  async function sanitizeEncodedBlob(blob, mimeType) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let cleaned = bytes;

    if (mimeType === "image/jpeg" || isJpeg(bytes)) cleaned = stripJpegMetadata(bytes);
    else if (mimeType === "image/png" || isPng(bytes)) cleaned = stripPngMetadata(bytes);
    else if (mimeType === "image/webp" || isWebP(bytes)) cleaned = stripWebPMetadata(bytes);

    return cleaned === bytes ? blob : new Blob([cleaned], { type: mimeType });
  }

  function stripJpegMetadata(data) {
    if (!isJpeg(data)) return data;
    const parts = [data.slice(0, 2)];
    let offset = 2;

    while (offset < data.length) {
      if (data[offset] !== 0xff) {
        parts.push(data.slice(offset));
        break;
      }
      const markerStart = offset;
      while (data[offset] === 0xff) offset += 1;
      const marker = data[offset++];

      if (marker === 0xda) {
        parts.push(data.slice(markerStart));
        break;
      }
      if (marker === 0xd8 || marker === 0xd9 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        parts.push(data.slice(markerStart, offset));
        continue;
      }
      if (offset + 2 > data.length) return data;

      const length = (data[offset] << 8) | data[offset + 1];
      const segmentEnd = offset + length;
      if (length < 2 || segmentEnd > data.length) return data;

      const sample = ascii(data, offset + 2, Math.min(length - 2, 90)).toLowerCase();
      const containsMetadata = marker === 0xe1 || marker === 0xed || marker === 0xfe || marker === 0xec || (marker === 0xe2 && sample.includes("icc_profile"));
      if (!containsMetadata) parts.push(data.slice(markerStart, segmentEnd));
      offset = segmentEnd;
    }
    return joinByteParts(parts);
  }

  function stripPngMetadata(data) {
    if (!isPng(data)) return data;
    const parts = [data.slice(0, 8)];
    const metadataChunks = new Set(["tEXt", "zTXt", "iTXt", "eXIf", "tIME", "iCCP"]);
    let offset = 8;

    while (offset + 12 <= data.length) {
      const length = readUint32BE(data, offset);
      const chunkEnd = offset + 12 + length;
      if (chunkEnd > data.length) return data;
      const type = ascii(data, offset + 4, 4);
      if (!metadataChunks.has(type)) parts.push(data.slice(offset, chunkEnd));
      offset = chunkEnd;
    }
    return offset === data.length ? joinByteParts(parts) : data;
  }

  function stripWebPMetadata(data) {
    if (!isWebP(data)) return data;
    const parts = [data.slice(0, 12)];
    const metadataChunks = new Set(["EXIF", "XMP ", "ICCP"]);
    let offset = 12;

    while (offset + 8 <= data.length) {
      const length = readUint32LE(data, offset + 4);
      const paddedLength = length + (length % 2);
      const chunkEnd = offset + 8 + paddedLength;
      if (chunkEnd > data.length) return data;
      const type = ascii(data, offset, 4);
      if (!metadataChunks.has(type)) parts.push(data.slice(offset, chunkEnd));
      offset = chunkEnd;
    }
    if (offset !== data.length) return data;

    const cleaned = joinByteParts(parts);
    const riffSize = cleaned.length - 8;
    cleaned[4] = riffSize & 0xff;
    cleaned[5] = (riffSize >>> 8) & 0xff;
    cleaned[6] = (riffSize >>> 16) & 0xff;
    cleaned[7] = (riffSize >>> 24) & 0xff;
    return cleaned;
  }

  function joinByteParts(parts) {
    const length = parts.reduce((total, part) => total + part.length, 0);
    const output = new Uint8Array(length);
    let offset = 0;
    parts.forEach((part) => {
      output.set(part, offset);
      offset += part.length;
    });
    return output;
  }

  function readUint32BE(data, offset) {
    return ((data[offset] << 24) >>> 0) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
  }

  function readUint32LE(data, offset) {
    return data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | ((data[offset + 3] << 24) >>> 0);
  }

  function getOutputDimensions(showErrors) {
    const width = parseInteger(elements.outputWidth.value);
    const height = parseInteger(elements.outputHeight.value);

    if (!width || !height || width < 1 || height < 1) {
      if (showErrors) showToast("Enter valid image dimensions.", true);
      return null;
    }
    if (width > 16384 || height > 16384) {
      if (showErrors) showToast("The limit is 16,384 pixels per dimension.", true);
      return null;
    }
    if (width * height > 64_000_000) {
      if (showErrors) showToast("The output can contain at most 64 megapixels.", true);
      return null;
    }
    return { width, height };
  }

  function preferredOutputFormat(inputType) {
    if (inputType === "image/jpeg" || inputType === "image/png" || inputType === "image/webp") return inputType;
    return "image/png";
  }

  function createOutputFilename(type) {
    const extension = type === "image/jpeg" ? "jpg" : type === "image/webp" ? "webp" : "png";
    if (elements.privateFilename.checked) {
      return `simage-protected-${randomToken()}.${extension}`;
    }
    const base = state.file.name.replace(/\.[^.]+$/, "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase() || "image";
    return `${base}-protected.${extension}`;
  }

  function randomToken() {
    if (window.crypto && crypto.getRandomValues) {
      const bytes = new Uint8Array(4);
      crypto.getRandomValues(bytes);
      return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    }
    return Math.random().toString(36).slice(2, 10);
  }

  function updateMetadataReport() {
    const { count, bytes, labels } = state.metadata;
    if (count > 0) {
      elements.metadataSummary.textContent = `${count} ${count === 1 ? "trace found" : "traces found"}`;
      elements.metadataBlocks.textContent = labels.length ? labels.join(" • ") : `${count} known blocks`;
      elements.metadataMeter.style.width = `${Math.min(100, 24 + count * 16)}%`;
    } else {
      elements.metadataSummary.textContent = "No known traces";
      elements.metadataBlocks.textContent = "Cleaning will still be applied";
      elements.metadataMeter.style.width = "16%";
    }
    elements.metadataSize.textContent = formatBytes(bytes);
  }

  function scanMetadata(buffer, mimeType) {
    const bytes = new Uint8Array(buffer);
    if (mimeType === "image/jpeg" || isJpeg(bytes)) return scanJpeg(bytes);
    if (mimeType === "image/png" || isPng(bytes)) return scanPng(bytes);
    if (mimeType === "image/webp" || isWebP(bytes)) return scanWebP(bytes);
    return { count: 0, bytes: 0, labels: [] };
  }

  function scanJpeg(data) {
    let offset = 2;
    let count = 0;
    let totalBytes = 0;
    const labels = new Set();

    while (offset + 4 <= data.length) {
      if (data[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      while (data[offset] === 0xff) offset += 1;
      const marker = data[offset++];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > data.length) break;

      const length = (data[offset] << 8) | data[offset + 1];
      if (length < 2 || offset + length > data.length) break;
      const contentStart = offset + 2;
      const sample = ascii(data, contentStart, Math.min(length - 2, 90)).toLowerCase();
      let label = null;

      if (marker === 0xe1) label = sample.startsWith("exif") ? "EXIF/GPS" : sample.includes("xmp") ? "XMP" : "APP1";
      else if (marker === 0xed) label = "IPTC";
      else if (marker === 0xfe) label = "Comment";
      else if (marker === 0xe2 && sample.includes("icc_profile")) label = "ICC profile";
      else if (marker === 0xec) label = "APP12";

      if (label) {
        count += 1;
        totalBytes += length + 2;
        labels.add(label);
      }
      offset += length;
    }
    return { count, bytes: totalBytes, labels: [...labels] };
  }

  function scanPng(data) {
    const metadataChunks = new Map([
      ["tEXt", "PNG text"],
      ["zTXt", "PNG text"],
      ["iTXt", "PNG text"],
      ["eXIf", "EXIF/GPS"],
      ["tIME", "Date/time"],
      ["iCCP", "ICC profile"]
    ]);
    let offset = 8;
    let count = 0;
    let totalBytes = 0;
    const labels = new Set();
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    while (offset + 12 <= data.length) {
      const length = view.getUint32(offset, false);
      const type = ascii(data, offset + 4, 4);
      if (offset + 12 + length > data.length) break;
      if (metadataChunks.has(type)) {
        count += 1;
        totalBytes += length + 12;
        labels.add(metadataChunks.get(type));
      }
      offset += length + 12;
      if (type === "IEND") break;
    }
    return { count, bytes: totalBytes, labels: [...labels] };
  }

  function scanWebP(data) {
    const metadataChunks = new Map([
      ["EXIF", "EXIF/GPS"],
      ["XMP ", "XMP"],
      ["ICCP", "ICC profile"]
    ]);
    let offset = 12;
    let count = 0;
    let totalBytes = 0;
    const labels = new Set();
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

    while (offset + 8 <= data.length) {
      const type = ascii(data, offset, 4);
      const length = view.getUint32(offset + 4, true);
      if (offset + 8 + length > data.length) break;
      if (metadataChunks.has(type)) {
        count += 1;
        totalBytes += length + 8;
        labels.add(metadataChunks.get(type));
      }
      offset += 8 + length + (length % 2);
    }
    return { count, bytes: totalBytes, labels: [...labels] };
  }

  function isJpeg(data) {
    return data.length > 2 && data[0] === 0xff && data[1] === 0xd8;
  }

  function isPng(data) {
    return data.length > 8 && data[0] === 0x89 && ascii(data, 1, 3) === "PNG";
  }

  function isWebP(data) {
    return data.length > 12 && ascii(data, 0, 4) === "RIFF" && ascii(data, 8, 4) === "WEBP";
  }

  function ascii(data, start, length) {
    let result = "";
    const end = Math.min(data.length, start + length);
    for (let index = start; index < end; index += 1) result += String.fromCharCode(data[index]);
    return result;
  }

  function setExportStatus(title, detail) {
    elements.exportStatus.textContent = title;
    elements.outputEstimate.textContent = detail;
  }

  function showToast(message, isError = false) {
    clearTimeout(toastTimer);
    elements.toast.textContent = message;
    elements.toast.classList.toggle("error", isError);
    elements.toast.classList.add("show");
    toastTimer = setTimeout(() => elements.toast.classList.remove("show"), 3300);
  }

  function parseInteger(value) {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function formatBytes(bytes) {
    if (!bytes) return "0 B";
    const units = ["B", "KB", "MB", "GB"];
    const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / (1024 ** index);
    return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
  }

  function formatNumber(number) {
    return new Intl.NumberFormat("en-US").format(number);
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  init();
})();
