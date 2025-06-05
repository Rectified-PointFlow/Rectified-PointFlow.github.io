// 1) IMPORTS (ensure your bundler or <script type="module"> can find these)
import * as THREE from 'three';
import { PCDLoader } from 'PCDLoader';
import { OrbitControls } from 'OrbitControls';

// 2) SAMPLE MAP + FRAME PARAMETERS
const sampleMap = {
  partnet_78:  ['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19'],
  partnet_652: ['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19'],
  partnet_680: ['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19']
};

const viewerParams = {
  partnet_78:  { groundHeight: -0.8, cameraY: 1.5  },
  partnet_652: { groundHeight: -0.8, cameraY: 1.5  },
  partnet_680: { groundHeight: -0.45, cameraY: 1.0  }
};

const totalFrames   = 20;   // steps per sample (originally 20)
const frameInterval = 40;  // ms per frame
const pauseDuration = 2500; // ms to pause at last frame
let slowMode = true;        // ★★ toggle “slow” vs “normal” playback

// 3) HSV → RGB HELPER (unchanged)
function hsvToRgb(h, s, v) {
  let r, g, b;
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    case 5: r = v; g = p; b = q; break;
  }
  return [r, g, b];
}

// 4) GLOBAL STATE
let isPaused = false;
let autoResample = true;
let currentFrameIdx = 0;
let playTimeoutId = null;

// We introduce a “session” counter. Each time selectObject() is called, we increment this.
// Any in‐flight timeouts/promises that finish for an old session will compare against this and bail out.
let currentSession = 0;

// Guard to avoid recursive sync‐calls
let isSyncing = false;

let inputState    = null;   // state for the static input viewer
let sampledStates = [];     // states for the two sampled viewers
let allStates     = [];     // [ inputState, ...sampledStates ]

const globalLoader = new PCDLoader();

// 5) UTILITY: PICK TWO DISTINCT RANDOM SAMPLES
function pickTwoRandomSamples(objName) {
  const arr = sampleMap[objName];
  if (!arr || arr.length < 2) {
    console.error(`Need ≥2 samples for "${objName}".`);
    return arr.slice(0, 2);
  }
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return [copy[0], copy[1]];
}

// 6) SYNC HELPERS FOR ORBITCONTROLS
function syncAnglesFrom(srcControls) {
  if (isSyncing) return;
  isSyncing = true;
  try {
    const cam = srcControls.object;
    const target = srcControls.target.clone();
    const offset = new THREE.Vector3().copy(cam.position).sub(target);
    const spherical = new THREE.Spherical().setFromVector3(offset);

    allStates.forEach((st) => {
      if (st.controls === srcControls) return;

      const newPos = new THREE.Vector3()
        .setFromSphericalCoords(spherical.radius, spherical.phi, spherical.theta)
        .add(st.controls.target);

      st.camera.position.copy(newPos);
      st.camera.lookAt(st.controls.target);
      st.controls.update();
    });
  } finally {
    isSyncing = false;
  }
}

// 7) INITIALIZE A STATIC INPUT VIEWER (colored by label)
function initInputViewer(container, objName) {
  const width  = container.clientWidth;
  const height = container.clientHeight;

  // Scene, camera, renderer
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xF5F5F5);

  const camera = new THREE.PerspectiveCamera(25, width / height, 0.1, 1000);
  camera.position.set(0, 1.4, 5);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(width, height);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // Lights
  const ambient = new THREE.AmbientLight(0xffffff, 1.8);
  scene.add(ambient);
  const dirLight = new THREE.DirectionalLight(0xffffff, 1);
  dirLight.position.set(5, 12, 5);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 1024;
  dirLight.shadow.mapSize.height = 1024;
  dirLight.shadow.camera.near = 1;
  dirLight.shadow.camera.far = 25;
  dirLight.shadow.camera.left = -10;
  dirLight.shadow.camera.right = 10;
  dirLight.shadow.camera.top = 10;
  dirLight.shadow.camera.bottom = -10;
  scene.add(dirLight);

  // Handle resize
  window.addEventListener('resize', () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });

  // “Loading…” overlay
  const loading = document.createElement('div');
  loading.classList.add('loading');
  loading.innerText = 'Loading…';
  container.appendChild(loading);

  // OrbitControls (auto‐rotate + drag‐pause + sync)
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 2;
  controls.update();

  // Track whether user is currently dragging
  controls.userIsInteracting = false;
  controls.domElement.addEventListener('mousedown', () => {
    controls.userIsInteracting = true;
  });
  document.addEventListener('mouseup', () => {
    controls.userIsInteracting = false;
  });

  controls.addEventListener('start', () => {
    // Disable auto‐rotate on all when any viewer is dragged
    allStates.forEach((st) => {
      st.controls.autoRotate = false;
    });
    // Disable the Rotate button itself
    document.getElementById('btn-rotate').disabled = true;
  });
  controls.addEventListener('end', () => {
    // Re‐enable auto‐rotate on all once dragging ends if the button text is still “On”
    const rotateBtn = document.getElementById('btn-rotate');
    const isAutoRotate = rotateBtn.innerHTML.includes(': On');
    console.log('End dragging, auto-rotate:', isAutoRotate);
    document.getElementById('btn-rotate').disabled = false;
    if (!isAutoRotate) return;
    allStates.forEach((st) => {
      st.controls.autoRotate = true;
    });
    // Sync final angles into others
    syncAnglesFrom(controls);
  });
  controls.addEventListener('change', () => {
    if (controls.userIsInteracting) {
      syncAnglesFrom(controls);
    }
  });

  // LOAD “pcd/${objName}/input.pcd” and build InstancedMesh of spheres
  const pcdUrl = `pcd/${objName}/input.pcd`;
  globalLoader.load(
    pcdUrl,
    (points) => {
      const geom = points.geometry;
      const posAttr = geom.attributes.position;
      const lblAttr = geom.attributes.label;

      if (!posAttr) {
        console.error(`No position attribute in ${pcdUrl}`);
        loading.innerText = 'Error';
        return;
      }

      const positions = posAttr.array;
      const N = positions.length / 3;
      const labels = lblAttr ? lblAttr.array : null;
      const sphereGeo = new THREE.SphereGeometry(0.01, 6, 6);
      const mat = new THREE.MeshStandardMaterial({
        transparent: true,
        metalness: 0.2,
        roughness: 0.4,
        depthWrite: true,
        flatShading: false
      });
      const instMesh = new THREE.InstancedMesh(sphereGeo, mat, N);
      instMesh.castShadow = true;
      instMesh.receiveShadow = false;

      const dummyMatrix = new THREE.Matrix4();
      const color = new THREE.Color();

      let maxLabel = 0;
      if (labels) {
        for (let i = 0; i < N; i++) {
          if (labels[i] > maxLabel) maxLabel = labels[i];
        }
      }

      for (let i = 0; i < N; i++) {
        const x = positions[3 * i];
        const y = positions[3 * i + 1];
        const z = positions[3 * i + 2];
        dummyMatrix.makeTranslation(x, y, z);
        instMesh.setMatrixAt(i, dummyMatrix);

        if (labels) {
          const lbl = labels[i];
          const hue = maxLabel > 0 ? (lbl / maxLabel) * 0.8 : 0;
          const hue_remap = (hue + 0.548) % 1;
          const [r, g, b] = hsvToRgb(hue_remap, 0.62, 0.46);
          color.setRGB(r, g, b);
        } else {
          color.setRGB(0.5, 0.5, 0.5);
        }
        instMesh.setColorAt(i, color);
      }

      scene.add(instMesh);
      loading.style.display = 'none';
      inputState.mesh = instMesh;

      geom.dispose();
      points.material.dispose();
    },
    () => { /* ignore progress */ },
    (err) => {
      console.error(`Error loading input PCD ${pcdUrl}:`, err);
      loading.innerText = 'Error';
    }
  );

  const state = {
    container,
    scene,
    camera,
    renderer,
    controls,
    mesh: null,
    isSampled: false
  };
  return state;
}

// 8) INITIALIZE A “SAMPLED” VIEWER (20‐frame animation)
//    We will add interpolation logic here.
function initSampledViewer(container, objName, initialSampleId) {
  const width  = container.clientWidth;
  const height = container.clientHeight;

  // Scene, camera, renderer
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xF5F5F5);

  const camera = new THREE.PerspectiveCamera(25, width / height, 0.1, 1000);
  camera.position.set(0, viewerParams[objName].cameraY, 5);
  camera.lookAt(0, 0, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(width, height);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // Lights
  const ambient = new THREE.AmbientLight(0xffffff, 1.8);
  scene.add(ambient);
  const dirLight = new THREE.DirectionalLight(0xffffff, 1);
  dirLight.position.set(5, 12, 5);
  dirLight.castShadow = true;
  dirLight.shadow.mapSize.width = 1024;
  dirLight.shadow.mapSize.height = 1024;
  dirLight.shadow.camera.near = 1;
  dirLight.shadow.camera.far = 25;
  dirLight.shadow.camera.left = -10;
  dirLight.shadow.camera.right = 10;
  dirLight.shadow.camera.top = 10;
  dirLight.shadow.camera.bottom = -10;
  scene.add(dirLight);

  // Ground plane
  const planeGeo = new THREE.PlaneGeometry(20, 20);
  const planeMat = new THREE.ShadowMaterial({ opacity: 0.2 });
  const ground = new THREE.Mesh(planeGeo, planeMat);
  ground.rotateX(-Math.PI / 2);
  ground.position.y = viewerParams[objName].groundHeight;
  ground.receiveShadow = true;
  scene.add(ground);

  // Handle resize
  window.addEventListener('resize', () => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  });

  // “Loading…” overlay
  const loading = document.createElement('div');
  loading.classList.add('loading');
  loading.innerText = 'Loading…';
  container.appendChild(loading);

  // OrbitControls (auto‐rotate + drag‐pause + sync)
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 2;
  controls.update();

  controls.userIsInteracting = false;
  controls.domElement.addEventListener('mousedown', () => {
    controls.userIsInteracting = true;
  });
  document.addEventListener('mouseup', () => {
    controls.userIsInteracting = false;
  });

  controls.addEventListener('start', () => {
    allStates.forEach((st) => {
      st.controls.autoRotate = false;
    });
    document.getElementById('btn-rotate').disabled = true;
  });
  controls.addEventListener('end', () => {
    allStates.forEach((st) => {
      st.controls.autoRotate = true;
    });
    document.getElementById('btn-rotate').disabled = false;
    syncAnglesFrom(controls);
  });
  controls.addEventListener('change', () => {
    if (controls.userIsInteracting) {
      syncAnglesFrom(controls);
    }
  });

  // Prepare array for 20 frames (original)
  const frameMeshes = new Array(totalFrames).fill(null);

  // ★★ We also store each frame’s raw position array for interpolation later
  //   framePositions[t] will be a Float32Array of length (3 * N_points) for frame t.
  const framePositions = new Array(totalFrames).fill(null);
  let N_points = 0;  // we’ll fill this once we load the very first frame

  // Assign this state's “session stamp” so we can detect stale callbacks
  const mySession = currentSession;

  const state = {
    container,
    scene,
    camera,
    renderer,
    controls,
    frameMeshes,
    framePositions,   // ★★ store raw positions
    N_points,         // ★★ number of points per frame
    currentSampleId: null,
    loadingOverlay: loading,
    isSampled: true,
    session: mySession
  };

  // Helper: pick a random sample ≠ current
  function pickRandomSample() {
    const arr = sampleMap[objName];
    if (arr.length === 1) return arr[0];
    let choice;
    do {
      choice = arr[Math.floor(Math.random() * arr.length)];
    } while (choice === state.currentSampleId);
    return choice;
  }

  // ★★ Helper: build a new InstancedMesh at the midpoint of two loaded frames
  function buildInterpolatedMesh(t0, t1) {
    // t0 and t1 are indices in [0..19], guaranteed to be loaded already
    const pos0 = state.framePositions[t0];
    const pos1 = state.framePositions[t1];
    if (!pos0 || !pos1) return null;

    const sphereGeo = new THREE.SphereGeometry(0.01, 6, 6);
    // We’ll use the same material settings; each frame used its own MeshStandardMaterial
    // For interpolation, we can just pick one standard material (color already baked per-instance).
    const mat = new THREE.MeshStandardMaterial({
      transparent: true,
      metalness: 0.2,
      roughness: 0.4,
      depthWrite: true,
      flatShading: false
    });

    const mesh = new THREE.InstancedMesh(sphereGeo, mat, state.N_points);
    mesh.castShadow = true;
    mesh.receiveShadow = false;

    const dummyMatrix = new THREE.Matrix4();
    const color = new THREE.Color();

    // Copy per-point color from frameMeshes[t0].  (Labels don’t change, so we simply reuse them.)
    // We assume frameMeshes[t0] exists and has instanceColor attribute.
    const srcMesh = state.frameMeshes[t0];

    // For every point i, we take midpoint of pos0[i], pos1[i], and copy color from srcMesh
    for (let i = 0; i < state.N_points; i++) {
      // positions are flat arrays [x0,y0,z0, x1,y1,z1, ...]
      const x0 = pos0[3 * i];
      const y0 = pos0[3 * i + 1];
      const z0 = pos0[3 * i + 2];
      const x1 = pos1[3 * i];
      const y1 = pos1[3 * i + 1];
      const z1 = pos1[3 * i + 2];

      const xm = 0.5 * (x0 + x1);
      const ym = 0.5 * (y0 + y1);
      const zm = 0.5 * (z0 + z1);
      dummyMatrix.makeTranslation(xm, ym, zm);
      mesh.setMatrixAt(i, dummyMatrix);

      // Copy color from srcMesh:
      if (srcMesh.instanceColor) {
        // Three.js InstancedMesh has `instanceColor` (InstancedBufferAttribute)
        // We can read it directly:
        const cA = srcMesh.instanceColor;
        const r = cA.getX(i);
        const g = cA.getY(i);
        const b = cA.getZ(i);
        color.setRGB(r, g, b);
      } else {
        // fallback to grey
        color.setRGB(0.5, 0.5, 0.5);
      }
      mesh.setColorAt(i, color);
    }

    mesh.visible = false;
    state.scene.add(mesh);
    return mesh;
  }

  // Load 20 frames from `sample_${sampleId}/step_t.pcd`
  async function loadSample(sampleId, showLoading = false) {
    // If this viewer’s session is stale, bail immediately.
    if (state.session !== currentSession) return;

    if (showLoading) {
      state.loadingOverlay.style.display = 'flex';
    }

    // Prepare newMeshes, but do NOT show anything until we’re sure
    const newMeshes = new Array(totalFrames).fill(null);
    const newPositions = new Array(totalFrames).fill(null);
    let sphereGeo = null;    // we’ll reuse one SphereGeometry
    let matTemplate = null;  // we’ll reuse one material to speed up

    for (let t = 0; t < totalFrames; t++) {
      const url = `pcd/${objName}/sample_${sampleId}/step_${t}.pcd`;
      // If session changed mid‐loop, bail out:
      if (state.session !== currentSession) {
        for (let k = 0; k < t; k++) {
          if (newMeshes[k]) {
            newMeshes[k].geometry.dispose();
            newMeshes[k].material.dispose();
          }
        }
        return;
      }

      await new Promise((resolve) => {
        globalLoader.load(
          url,
          (points) => {
            const geom = points.geometry;
            const posAttr = geom.attributes.position;
            const lblAttr = geom.attributes.label;
            if (!posAttr) {
              console.error(`No position attribute in ${url}`);
              newMeshes[t] = null;
              newPositions[t] = null;
              resolve();
              return;
            }
            const positions = posAttr.array; // Float32Array
            const N = positions.length / 3;
            if (t === 0) {
              // record how many points there are in each frame
              state.N_points = N;
            }
            // Copy positions into a fresh Float32Array so we can interpolate later:
            newPositions[t] = new Float32Array(positions);

            // Build InstancedMesh of tiny spheres
            if (!sphereGeo) sphereGeo = new THREE.SphereGeometry(0.01, 6, 6);
            const mat = new THREE.MeshStandardMaterial({
              transparent: true,
              metalness: 0.2,
              roughness: 0.4,
              depthWrite: true,
              flatShading: false
            });
            const instMesh = new THREE.InstancedMesh(sphereGeo, mat, N);
            instMesh.castShadow = true;
            instMesh.receiveShadow = false;

            const dummyMatrix = new THREE.Matrix4();
            const color = new THREE.Color();

            let maxLabel = 0;
            if (lblAttr) {
              for (let i = 0; i < N; i++) {
                if (lblAttr.array[i] > maxLabel) maxLabel = lblAttr.array[i];
              }
            }

            for (let i = 0; i < N; i++) {
              const x = positions[3 * i];
              const y = positions[3 * i + 1];
              const z = positions[3 * i + 2];
              dummyMatrix.makeTranslation(x, y, z);
              instMesh.setMatrixAt(i, dummyMatrix);

              if (lblAttr) {
                const lbl = lblAttr.array[i];
                const hue = maxLabel > 0 ? (lbl / maxLabel) * 0.8 : 0;
                const hue_remap = (hue + 0.548) % 1;
                const [r, g, b] = hsvToRgb(hue_remap, 0.62, 0.46);
                color.setRGB(r, g, b);
              } else {
                color.setRGB(0.5, 0.5, 0.5);
              }
              instMesh.setColorAt(i, color);
            }

            instMesh.visible = false;
            newMeshes[t] = instMesh;
            state.scene.add(instMesh);

            geom.dispose();
            points.material.dispose();
            resolve();
          },
          () => { /* ignore progress */ },
          (err) => {
            console.error(`Error loading ${url}:`, err);
            newMeshes[t] = null;
            newPositions[t] = null;
            resolve();
          }
        );
      });

      // If session changed while waiting for this particular frame, bail out now:
      if (state.session !== currentSession) {
        for (let k = 0; k <= t; k++) {
          if (newMeshes[k]) {
            newMeshes[k].geometry.dispose();
            newMeshes[k].material.dispose();
          }
        }
        return;
      }
    }

    // Done loading all frames. If this viewer’s session is still valid, swap in newMeshes.
    if (state.session !== currentSession) {
      // Already disposed above, but just in case:
      newMeshes.forEach((m) => {
        if (m) {
          m.geometry.dispose();
          m.material.dispose();
        }
      });
      return;
    }

    if (showLoading) {
      state.loadingOverlay.style.display = 'none';
    }

    // Dispose old meshes
    state.frameMeshes.forEach((oldMesh) => {
      if (oldMesh) {
        state.scene.remove(oldMesh);
        oldMesh.geometry.dispose();
        oldMesh.material.dispose();
      }
    });
    // Swap in new meshes
    state.frameMeshes = newMeshes;
    state.framePositions = newPositions; // ★★ store the newly loaded positions
    state.currentSampleId = sampleId;

    // **BUG #3 FIX:** Only make the “currentFrameIdx” visible if showLoading == true.
    if (showLoading) {
      const idx = currentFrameIdxMapping(); // below helper
      if (idx.isOriginal && state.frameMeshes[idx.frameIndex]) {
        state.frameMeshes[idx.frameIndex].visible = true;
      }
      // If slowMode and the very first frame is an interpolated one (it isn’t by our mapping), we'd handle that too.
    }
  }

  state.currentSampleId = initialSampleId;
  state.pickRandom = pickRandomSample;
  state.loadSample = loadSample;

  // Immediately start the first load, and show frame 0 once it finishes.
  loadSample(initialSampleId, true);

  return state;

  // ★★ Helper to map a “globalFrame” (0..(20 or 39)-1) to either an original frame or an interpolated slot.
  function currentFrameIdxMapping() {
    if (!slowMode) {
      // normal: globalFrame = [0..19]
      return { isOriginal: true, frameIndex: currentFrameIdx, alpha: 0 };
    } else {
      // slowMode: globalFrame = [0..38]
      const g = currentFrameIdx; // 0..38
      if (g % 2 === 0) {
        // even → exactly original frame at index g/2
        return { isOriginal: true, frameIndex: g / 2, alpha: 0 };
      } else {
        // odd → interpolated between floor(g/2) and ceil(g/2)
        const i0 = Math.floor(g / 2);
        const i1 = i0 + 1;
        return { isOriginal: false, frameIndex: i0, nextIndex: i1, alpha: 0.5 };
      }
    }
  }
}

// 9) TEARDOWN: CLEAR ALL VIEWERS (disposing Three.js objects)
function clearAllViewers() {
  // Force any in‐flight advanceAllFrames to bail
  currentSession++;

  // Clear the one outstanding timeout for advanceAllFrames
  clearTimeout(playTimeoutId);

  allStates.forEach((st) => {
    if (st.isSampled) {
      st.frameMeshes.forEach((m) => {
        if (m) {
          st.scene.remove(m);
          m.geometry.dispose();
          m.material.dispose();
        }
      });
      // ★★ Also remove any interpolated meshes left behind.
      //    We placed them into scene within buildInterpolatedMesh and never stored references,
      //    but we can simply traverse the scene to find InstancedMesh whose geometry is a Sphere
      //    and is not one of the original frameMeshes. For simplicity, we skip explicit disposal here,
      //    trusting garbage collection—if memory becomes an issue, you can track and dispose them explicitly.
    } else {
      if (st.mesh) {
        st.scene.remove(st.mesh);
        if (st.mesh.geometry) st.mesh.geometry.dispose();
        if (st.mesh.material) st.mesh.material.dispose();
      }
    }
    if (st.renderer && st.renderer.domElement) {
      st.container.removeChild(st.renderer.domElement);
      st.renderer.dispose();
    }
  });

  document.querySelector('.viewers-container').innerHTML = '';
  inputState = null;
  sampledStates = [];
  allStates = [];
}

// 10) ADVANCE FRAMES (two sampled viewers in sync)
//     We now handle either normal(20) or slowMode(39) mapping.
function advanceAllFrames(session) {
  // If this is a stale call, or if we have no viewers left, bail.
  if (session !== currentSession || sampledStates.length === 0) return;
  if (isPaused) return;

  // ★★ Compute how many “global frames” exist:
  const globalTotal = slowMode ? (totalFrames * 2 - 1) : totalFrames;
  const g = currentFrameIdx;        // [0..globalTotal-1]
  const prevG = (g - 1 + globalTotal) % globalTotal;

  sampledStates.forEach((st) => {
    // Figure out what we showed at prevG vs. what to show at g
    const prevMap = mapGlobalToLocal(prevG, st);
    const currMap = mapGlobalToLocal(g, st);

    // Hide whichever mesh was visible previously:
    if (prevMap.isOriginal) {
      const oldIdx = prevMap.frameIndex;
      if (st.frameMeshes[oldIdx]) st.frameMeshes[oldIdx].visible = false;
    } else {
      // It was an interpolated mesh—hide it.
      const name = `interp_${st.currentSampleId}_${prevMap.frameIndex}_${prevMap.nextIndex}_${prevG}`;
      const obj = st.scene.getObjectByName(name);
      if (obj) obj.visible = false;
    }

    // Show the current one:
    if (currMap.isOriginal) {
      const idx = currMap.frameIndex;
      if (st.frameMeshes[idx]) st.frameMeshes[idx].visible = true;
    } else {
      // Build (or lookup) the interpolated mesh between frameIndex and nextIndex for this g:
      const i0 = currMap.frameIndex;
      const i1 = currMap.nextIndex;
      const interpName = `interp_${st.currentSampleId}_${i0}_${i1}_${g}`;
      let mesh = st.scene.getObjectByName(interpName);
      if (!mesh) {
        mesh = buildInterpolatedMeshForState(st, i0, i1, g);
      }
      if (mesh) {
        mesh.visible = true;
      }
    }
  });

  // Now schedule the next tick:
  if (g === globalTotal - 1) {
    // We’re at the very last “global frame” → pause, then (if autoResample) load both samples
    if (autoResample) {
      playTimeoutId = setTimeout(async () => {
        if (session !== currentSession) return;

        // 1) Pick a new random sample for each viewer
        const newIds = sampledStates.map((st) => st.pickRandom());

        // 2) Kick off BOTH loadSample calls, and WAIT until they both finish
        await Promise.all(
          sampledStates.map((st, i) => st.loadSample(newIds[i], false))
        );

        // 3) Once both are done, if still valid session & not paused, restart from frame 0
        if (session !== currentSession) return;
        if (!isPaused) {
          currentFrameIdx = 0;
          advanceAllFrames(session);
        }
      }, pauseDuration);
    } else {
      playTimeoutId = setTimeout(() => {
        if (session !== currentSession) return;
        if (!isPaused) {
          currentFrameIdx = 0;
          advanceAllFrames(session);
        }
      }, pauseDuration);
    }
  } else {
    playTimeoutId = setTimeout(() => {
      if (session !== currentSession) return;
      if (!isPaused) {
        currentFrameIdx = (currentFrameIdx + 1) % globalTotal;
        advanceAllFrames(session);
      }
    }, frameInterval);
  }

  // --- helper to map “global frame index” → {isOriginal, frameIndex, nextIndex, alpha} ---
  function mapGlobalToLocal(globalIdx, st) {
    if (!slowMode) {
      // Normal mode: each global frame = an original
      return { isOriginal: true, frameIndex: globalIdx, alpha: 0 };
    } else {
      if (globalIdx % 2 === 0) {
        // even → exactly original
        return { isOriginal: true, frameIndex: globalIdx / 2, alpha: 0 };
      } else {
        // odd → midpoint between two originals
        const i0 = Math.floor(globalIdx / 2);
        const i1 = i0 + 1;
        return { isOriginal: false, frameIndex: i0, nextIndex: i1, alpha: 0.5 };
      }
    }
  }

  // ★★ helper to build (and name) the interpolated mesh in `st` for indices (i0, i1).
  function buildInterpolatedMeshForState(st, i0, i1, globalIdx) {
    // We want to name this mesh so we can find/hide it on subsequent frames:
    const name = `interp_${st.currentSampleId}_${i0}_${i1}_${globalIdx}`;
    const pos0 = st.framePositions[i0];
    const pos1 = st.framePositions[i1];
    if (!pos0 || !pos1) return null;

    // Build one new InstancedMesh that lives in st.scene.
    const sphereGeo = new THREE.SphereGeometry(0.01, 6, 6);
    const mat = new THREE.MeshStandardMaterial({
      transparent: true,
      metalness: 0.2,
      roughness: 0.4,
      depthWrite: true,
      flatShading: false
    });
    const mesh = new THREE.InstancedMesh(sphereGeo, mat, st.N_points);
    mesh.castShadow = true;
    mesh.receiveShadow = false;
    mesh.name = name; // so we can find it later

    const dummyMatrix = new THREE.Matrix4();
    const color = new THREE.Color();
    const srcMesh = st.frameMeshes[i0]; // read colors from older frame

    for (let i = 0; i < st.N_points; i++) {
      const x0 = pos0[3 * i], y0 = pos0[3 * i + 1], z0 = pos0[3 * i + 2];
      const x1 = pos1[3 * i], y1 = pos1[3 * i + 1], z1 = pos1[3 * i + 2];
      const xm = 0.5 * (x0 + x1), ym = 0.5 * (y0 + y1), zm = 0.5 * (z0 + z1);
      dummyMatrix.makeTranslation(xm, ym, zm);
      mesh.setMatrixAt(i, dummyMatrix);

      if (srcMesh.instanceColor) {
        const cA = srcMesh.instanceColor;
        const r = cA.getX(i), g = cA.getY(i), b = cA.getZ(i);
        color.setRGB(r, g, b);
      } else {
        color.setRGB(0.5, 0.5, 0.5);
      }
      mesh.setColorAt(i, color);
    }

    mesh.visible = false;
    st.scene.add(mesh);
    return mesh;
  }
}

// 11) RENDER LOOP (calls controls.update + render each scene)
function animateAll() {
  requestAnimationFrame(animateAll);

  allStates.forEach((st) => {
    st.controls.update();
    st.renderer.render(st.scene, st.camera);
  });
}

// 12) BUILD VIEWERS WHEN A TAB IS CLICKED
function selectObject(objName) {
  // 1) Tear down anything from the last session
  clearAllViewers();

  // 2) Mark active tab
  document.querySelectorAll('.tab-button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.obj === objName);
  });

  // 3) Increment session so that any in‐flight timeouts/promises from before will bail out.
  currentSession++;

  const vc = document.querySelector('.viewers-container');

  // A) “Condition / Unposed Part Point Clouds” (static input)
  const inputWrapper = document.createElement('div');
  inputWrapper.style.display = 'flex';
  inputWrapper.style.flexDirection = 'column';
  inputWrapper.style.alignItems = 'center';

  const inputCaption = document.createElement('div');
  inputCaption.classList.add('viewer-caption');
  inputCaption.innerHTML =
    'Condition<hr><span class="viewer-subcaption">Unposed Part Point Clouds</span>';
  inputWrapper.appendChild(inputCaption);

  const inputDiv = document.createElement('div');
  inputDiv.classList.add('viewer');
  inputDiv.style.flex = '1 1 280px';
  inputWrapper.appendChild(inputDiv);

  vc.appendChild(inputWrapper);
  inputState = initInputViewer(inputDiv, objName);

  // B) “Generation / Possible Assembled Point Clouds” (two sampled viewers)
  const assembledBlock = document.createElement('div');
  assembledBlock.style.display = 'flex';
  assembledBlock.style.flexDirection = 'column';

  const assembledCaption = document.createElement('div');
  assembledCaption.classList.add('assembled-caption');
  assembledCaption.innerHTML =
    'Generation<hr><span class="assembled-subcaption">Possible Assembled Point Clouds</span>';
  assembledBlock.appendChild(assembledCaption);

  const twoWrap = document.createElement('div');
  twoWrap.classList.add('assembled-container');

  // First sampled viewer
  const sampleWrapper1 = document.createElement('div');
  sampleWrapper1.style.display = 'flex';
  sampleWrapper1.style.flexDirection = 'column';
  sampleWrapper1.style.alignItems = 'center';

  const sampleDiv1 = document.createElement('div');
  sampleDiv1.classList.add('viewer');
  sampleDiv1.style.flex = '1 1 280px';
  sampleWrapper1.appendChild(sampleDiv1);

  twoWrap.appendChild(sampleWrapper1);

  // Second sampled viewer
  const sampleWrapper2 = document.createElement('div');
  sampleWrapper2.style.display = 'flex';
  sampleWrapper2.style.flexDirection = 'column';
  sampleWrapper2.style.alignItems = 'center';

  const sampleDiv2 = document.createElement('div');
  sampleDiv2.classList.add('viewer');
  sampleDiv2.style.flex = '1 1 280px';
  sampleWrapper2.appendChild(sampleDiv2);

  twoWrap.appendChild(sampleWrapper2);

  assembledBlock.appendChild(twoWrap);
  vc.appendChild(assembledBlock);

  // Initialize the two sampled viewers with two random sample IDs
  const [id1, id2] = pickTwoRandomSamples(objName);
  const state1 = initSampledViewer(sampleDiv1, objName, id1);
  const state2 = initSampledViewer(sampleDiv2, objName, id2);
  sampledStates = [state1, state2];

  allStates = [inputState, state1, state2];

  // Reset frame index & begin animation/resampling loop
  currentFrameIdx = 0;
  advanceAllFrames(currentSession);
}

// 13) HOOK UP TAB BUTTONS + “Rotate” BUTTON ONCE DOM IS READY
window.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.tab-button').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectObject(btn.dataset.obj);
    });
  });

  // Hook up the “Rotate” button to toggle auto‐rotation
  const rotateBtn = document.getElementById('btn-rotate');
  rotateBtn.addEventListener('click', () => {
    // If any viewer is currently auto‐rotating, turn them all off; otherwise, turn them all on
    const anyAuto = allStates.some((st) => st.controls.autoRotate);
    if (anyAuto) {
      allStates.forEach((st) => {
        st.controls.autoRotate = false;
      });
    } else {
      allStates.forEach((st) => {
        st.controls.autoRotate = true;
      });
    }
    // Re‐enable the button (in case it was disabled while dragging)
    rotateBtn.disabled = false;
    console.log('Toggled auto-rotation');
    // Set the button text accordingly
    const anyAuto2 = allStates.some((st) => st.controls.autoRotate);
    rotateBtn.innerHTML = anyAuto2
      ? '<i class="fas fa-sync-alt"></i> Auto Rotate: On '
      : '<i class="fas fa-sync-alt"></i> Auto Rotate: Off';
  });

  // Show the first object by default
  selectObject('partnet_652');

  // Start the render loop
  animateAll();
});
