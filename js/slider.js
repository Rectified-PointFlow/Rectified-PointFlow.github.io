// slider.js
// Loaded as <script type="module" src="./slider.js"> in index.html.
// We import parseGIF + decompressFrames from gifuct-js on esm.sh.

import { parseGIF, decompressFrames } from "https://esm.sh/gifuct-js@2.1.2";

document.addEventListener("DOMContentLoaded", async () => {
  // ======= READ CONFIGURATION FROM data- ATTRIBUTES =======
  const container   = document.querySelector(".slider-container");
  const gifUrl      = container.dataset.gifUrl;                   // e.g. "path/to/your.gif"
  const frameStart  = parseInt(container.dataset.frameStart, 10); // e.g. 5
  const frameEnd    = parseInt(container.dataset.frameEnd,   10); // e.g. 15

  // Crop parameters (in pixels). Adjust to remove unwanted area.
  const cropX       = 430;
  const cropY       = 50;
  const cropWidth   = 340; 
  const cropHeight  = 260;
  // ===========================================================

  // DOM references
  const startCanvas = document.getElementById("startCanvas");
  const midCanvas   = document.getElementById("midCanvas");
  const endCanvas   = document.getElementById("endCanvas");
  const slider      = document.getElementById("frameSlider");
  const midCaption  = document.getElementById("midCaption");

  // 1) Fetch the GIF as an ArrayBuffer
  const resp        = await fetch(gifUrl);
  const arrayBuffer = await resp.arrayBuffer();

  // 2) Parse & decompress all frames, with buildPatch = true
  const parsedGif   = parseGIF(arrayBuffer);
  const frames      = decompressFrames(parsedGif, /* buildPatch = */ true);

  // The GIF’s “logical screen” (full‐canvas) dimensions:
  const logicalWidth   = parsedGif.lsd.width;
  const logicalHeight  = parsedGif.lsd.height;

  // Number of frames (0..length−1)
  const totalGifFrames = frames.length - 1;

  // Clamp frameStart/frameEnd into [0..totalGifFrames]
  const startIdx = Math.max(0, Math.min(frameStart, totalGifFrames));
  const endIdx   = Math.max(0, Math.min(frameEnd,   totalGifFrames));

  // If user gave startIdx > endIdx, swap them so rangeStart ≤ rangeEnd
  const rangeStart = Math.min(startIdx, endIdx);
  const rangeEnd   = Math.max(startIdx, endIdx);

  // Configure the range slider
  slider.min   = rangeStart;
  slider.max   = rangeEnd;
  slider.value = rangeStart;

  // Resize each visible <canvas> to the desired crop size (internal resolution)
  [startCanvas, midCanvas, endCanvas].forEach((cnv) => {
    cnv.width  = cropWidth;
    cnv.height = cropHeight;
  });

  // Create an offscreen “master” canvas that matches the GIF’s logical screen.
  const masterCanvas = document.createElement("canvas");
  masterCanvas.width  = logicalWidth;
  masterCanvas.height = logicalHeight;
  const masterCtx = masterCanvas.getContext("2d");

  // We will store a full‐canvas ImageData for each frame in this array:
  const fullFrames = new Array(frames.length);

  // ─── COMPOSITE EACH FRAME INTO fullFrames[i] ───
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i];
    // (a) If previous frame asked for disposalType=2, clear that rectangle
    if (i > 0) {
      const prev = frames[i - 1];
      if (prev.disposalType === 2) {
        masterCtx.clearRect(
          prev.dims.left,
          prev.dims.top,
          prev.dims.width,
          prev.dims.height
        );
      }
      // disposalType 0 or 1 → do not clear; leave underlying pixels intact
    }
    // (b) Draw this frame’s patch onto the master canvas
    const patchImageData = new ImageData(
      frame.patch,
      frame.dims.width,
      frame.dims.height
    );
    masterCtx.putImageData(patchImageData, frame.dims.left, frame.dims.top);
    // (c) Snapshot the entire master canvas into an ImageData
    fullFrames[i] = masterCtx.getImageData(0, 0, logicalWidth, logicalHeight);
  }

  // ─── FUNCTION TO DRAW A CROPPED FRAME ───
  function drawCroppedFrame(frameIndex, targetCanvas) {
    // 1) Retrieve the full‐canvas ImageData for frameIndex
    const fullFrameData = fullFrames[frameIndex];

    // 2) Paint it onto a temporary offscreen canvas
    const temp = document.createElement("canvas");
    temp.width  = logicalWidth;
    temp.height = logicalHeight;
    const tctx = temp.getContext("2d");
    tctx.putImageData(fullFrameData, 0, 0);

    // 3) Copy only the crop rectangle into the visible canvas
    const ctx = targetCanvas.getContext("2d");
    ctx.clearRect(0, 0, cropWidth, cropHeight);
    ctx.drawImage(
      temp,
      cropX, cropY,          // Source top-left of the crop
      cropWidth, cropHeight, // Source size of the crop
      0, 0,                  // Destination top-left in our target canvas
      cropWidth, cropHeight  // Destination size in our target canvas
    );
  }

  // ─── INITIAL RENDER ───
  drawCroppedFrame(rangeStart, startCanvas);
  drawCroppedFrame(rangeStart, midCanvas);
  drawCroppedFrame(rangeEnd,   endCanvas);

  // Compute initial “s” = (rangeStart − rangeStart)/(rangeEnd − rangeStart) → “0.00”
  const initialS = rangeEnd > rangeStart
    ? ((rangeStart - rangeStart) / (rangeEnd - rangeStart)).toFixed(2)
    : "0.00";
//   midCaption.textContent = `Noise Z(${initialS})`;

  // ─── SLIDER EVENT HANDLER ───
  slider.addEventListener("input", (e) => {
    const idx = parseInt(e.target.value, 10);
    drawCroppedFrame(idx, midCanvas);

    let s = "0.00";
    if (rangeEnd > rangeStart) {
      s = ((idx - rangeStart) / (rangeEnd - rangeStart)).toFixed(2);
    }
    // midCaption.textContent = `Noise Z(${s})`;
  });

  // ─── DYNAMIC RESIZE / SCALING ───
  // After drawing everything at “native” 400×200 size, see if the container is too wide.
  function scaleContainerToFit() {
    const parentWidth    = container.parentElement.clientWidth;
    const containerWidth = container.scrollWidth;
    const scaleFactor = (0.8 * parentWidth) / (cropWidth * 3); // 20px for margins

    // If the container is wider than its parent, shrink canvases + margins.
    if (scaleFactor < 1) {
      
      console.log(`Scaling down by factor: ${scaleFactor}`);

      // 1) Shrink each canvas via CSS
      [startCanvas, midCanvas, endCanvas].forEach((cnv) => {
        cnv.style.width  = `${cropWidth * scaleFactor}px`;
        cnv.style.height = `${cropHeight * scaleFactor}px`;
      });

      // 2) Shrink each block’s horizontal margins by the same factor
      document.querySelectorAll(".slider-block").forEach((blk) => {
        // original margin: 0 10px → we scale thirty two
        const m = 1;
        blk.style.marginLeft  = `${m}px`;
        blk.style.marginRight = `${m}px`;
      });
    } else {
      // If there’s enough room, remove any forced CSS scaling
      [startCanvas, midCanvas, endCanvas].forEach((cnv) => {
        cnv.style.width  = "";
        cnv.style.height = "";
      });
      document.querySelectorAll(".slider-block").forEach((blk) => {
        blk.style.marginLeft  = "";
        blk.style.marginRight = "";
      });
    }
  }

  // Run it once now that everything is drawn
  scaleContainerToFit();

  // Also re‐run on window resize
  window.addEventListener("resize", scaleContainerToFit);
});
