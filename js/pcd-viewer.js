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
  partnet_652: { groundHeight: -0.85, cameraY: 1.5  },
  partnet_680: { groundHeight: -0.45, cameraY: 1.0  }
};

const totalFrames   = 20;    // steps per sample
const frameInterval = 40;    // ms per frame
const pauseDuration = 2500;  // ms to pause at last frame
let slowMode = true;         // toggle “slow” vs “normal” playback

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

// We introduce a “session” counter. Any in‐flight timeouts/promises that finish for an old session will bail out.
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

  // Prepare array for 20 frames
  const frameMeshes = new Array(totalFrames).fill(null);
  const framePositions = new Array(totalFrames).fill(null);
  let N_points = 0;  // will be set once frame 0 loads

  // Assign this state's “session stamp”
  const mySession = currentSession;

  const state = {
    container,
    scene,
    camera,
    renderer,
    controls,
    frameMeshes,
    framePositions,
    N_points,
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

  // Helper: build a new InstancedMesh at the midpoint of two loaded frames
  function buildInterpolatedMesh(t0, t1) {
    const pos0 = state.framePositions[t0];
    const pos1 = state.framePositions[t1];
    if (!pos0 || !pos1) return null;

    const sphereGeo = new THREE.SphereGeometry(0.01, 6, 6);
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
    const srcMesh = state.frameMeshes[t0];

    for (let i = 0; i < state.N_points; i++) {
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

      if (srcMesh.instanceColor) {
        const cA = srcMesh.instanceColor;
        const r = cA.getX(i);
        const g = cA.getY(i);
        const b = cA.getZ(i);
        color.setRGB(r, g, b);
      } else {
        color.setRGB(0.5, 0.5, 0.5);
      }
      mesh.setColorAt(i, color);
    }

    mesh.visible = false;
    state.scene.add(mesh);
    return mesh;
  }

  async function loadSample(sampleId, showLoading = false) {
    // If this viewer’s session is stale, bail immediately.
    if (state.session !== currentSession) return null;

    if (showLoading) {
      state.loadingOverlay.style.display = 'flex';
    }

    const newMeshes = new Array(totalFrames).fill(null);
    const newPositions = new Array(totalFrames).fill(null);
    let sphereGeo = null;

    for (let t = 0; t < totalFrames; t++) {
      const url = `pcd/${objName}/sample_${sampleId}/step_${t}.pcd`;

      if (state.session !== currentSession) {
        for (let k = 0; k < t; k++) {
          if (newMeshes[k]) {
            newMeshes[k].geometry.dispose();
            newMeshes[k].material.dispose();
          }
        }
        return null;
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

            const positions = posAttr.array;
            const N = positions.length / 3;
            if (t === 0) {
              state.N_points = N;
            }
            newPositions[t] = new Float32Array(positions);

            if (!sphereGeo) sphereGeo = new THREE.SphereGeometry(0.01, 6, 4);
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

      if (state.session !== currentSession) {
        for (let k = 0; k <= t; k++) {
          if (newMeshes[k]) {
            newMeshes[k].geometry.dispose();
            newMeshes[k].material.dispose();
          }
        }
        return null;
      }
    }

    if (state.session !== currentSession) {
      newMeshes.forEach((m) => {
        if (m) {
          m.geometry.dispose();
          m.material.dispose();
        }
      });
      return null;
    }

    if (showLoading) {
      state.loadingOverlay.style.display = 'none';

      state.frameMeshes.forEach((oldMesh) => {
        if (oldMesh) {
          state.scene.remove(oldMesh);
          oldMesh.geometry.dispose();
          oldMesh.material.dispose();
        }
      });

      state.frameMeshes = newMeshes;
      state.framePositions = newPositions;
      state.currentSampleId = sampleId;

      const idx = currentFrameIdxMapping();
      if (idx.isOriginal && state.frameMeshes[idx.frameIndex]) {
        state.frameMeshes[idx.frameIndex].visible = true;
      }
      return null;
    } else {
      return { newMeshes, newPositions, sampleId };
    }
  }

  state.currentSampleId = initialSampleId;
  state.pickRandom = pickRandomSample;
  state.loadSample = loadSample;

  // Immediately start the first load, and show frame 0 once it finishes.
  loadSample(initialSampleId, true);

  return state;

  function currentFrameIdxMapping() {
    if (!slowMode) {
      return { isOriginal: true, frameIndex: currentFrameIdx, alpha: 0 };
    } else {
      const g = currentFrameIdx;
      if (g % 2 === 0) {
        return { isOriginal: true, frameIndex: g / 2, alpha: 0 };
      } else {
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
      // Note: Interpolated meshes will be garbage‐collected if not explicitly removed.
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
function advanceAllFrames(session) {
  if (session !== currentSession || sampledStates.length === 0) return;
  if (isPaused) return;

  const globalTotal = slowMode ? (totalFrames * 2 - 1) : totalFrames;
  const g = currentFrameIdx;
  const prevG = (g - 1 + globalTotal) % globalTotal;

  sampledStates.forEach((st) => {
    const prevMap = mapGlobalToLocal(prevG, st);
    const currMap = mapGlobalToLocal(g, st);

    if (prevMap.isOriginal) {
      const oldIdx = prevMap.frameIndex;
      if (st.frameMeshes[oldIdx]) st.frameMeshes[oldIdx].visible = false;
    } else {
      const name = `interp_${st.currentSampleId}_${prevMap.frameIndex}_${prevMap.nextIndex}_${prevG}`;
      const obj = st.scene.getObjectByName(name);
      if (obj) obj.visible = false;
    }

    if (currMap.isOriginal) {
      const idx = currMap.frameIndex;
      if (st.frameMeshes[idx]) st.frameMeshes[idx].visible = true;
    } else {
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

  if (g === globalTotal - 1) {
    if (autoResample) {
      playTimeoutId = setTimeout(async () => {
        if (session !== currentSession) return;

        // 1) Get each viewer’s current sample ID
        const curr0 = sampledStates[0].currentSampleId;
        const curr1 = sampledStates[1].currentSampleId;

        // 2) Pick a new ID for viewer 0 (≠ curr0 and ≠ curr1)
        let newId0;
        do {
          newId0 = sampledStates[0].pickRandom();
        } while (newId0 === curr1);

        // 3) Pick a new ID for viewer 1 (≠ curr1, ≠ curr0, and ≠ newId0)
        let newId1;
        do {
          newId1 = sampledStates[1].pickRandom();
        } while (newId1 === curr0 || newId1 === newId0);

        // 4) Kick off BOTH loadSample calls with showLoading=false,
        //    and capture their return values so we can swap them in:
        const [res0, res1] = await Promise.all([
          sampledStates[0].loadSample(newId0, false),
          sampledStates[1].loadSample(newId1, false)
        ]);

        // 5) If session changed during loading, bail out:
        if (session !== currentSession) return;

        // 6) For each viewer, dispose old meshes and swap in the new ones:
        [res0, res1].forEach((res, i) => {
          const st = sampledStates[i];
          if (!res) return; // in case loadSample bailed

          // 6a) Remove and dispose old meshes from the scene:
          st.frameMeshes.forEach((oldMesh) => {
            if (oldMesh) {
              st.scene.remove(oldMesh);
              oldMesh.geometry.dispose();
              oldMesh.material.dispose();
            }
          });

          // 6b) Swap in:
          st.frameMeshes = res.newMeshes;
          st.framePositions = res.newPositions;
          st.currentSampleId = res.sampleId;

          // 6c) Show frame 0 of the new sample immediately:
          if (st.frameMeshes[0]) {
            st.frameMeshes[0].visible = true;
          }
        });

        // 7) Now restart from frame 0, if still valid
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
      return { isOriginal: true, frameIndex: globalIdx, alpha: 0 };
    } else {
      if (globalIdx % 2 === 0) {
        return { isOriginal: true, frameIndex: globalIdx / 2, alpha: 0 };
      } else {
        const i0 = Math.floor(globalIdx / 2);
        const i1 = i0 + 1;
        return { isOriginal: false, frameIndex: i0, nextIndex: i1, alpha: 0.5 };
      }
    }
  }

  // Helper to build (and name) the interpolated mesh in `st` for indices (i0, i1).
  function buildInterpolatedMeshForState(st, i0, i1, globalIdx) {
    const name = `interp_${st.currentSampleId}_${i0}_${i1}_${globalIdx}`;
    const pos0 = st.framePositions[i0];
    const pos1 = st.framePositions[i1];
    if (!pos0 || !pos1) return null;

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
    mesh.name = name;

    const dummyMatrix = new THREE.Matrix4();
    const color = new THREE.Color();
    const srcMesh = st.frameMeshes[i0];

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
    rotateBtn.disabled = false;
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
