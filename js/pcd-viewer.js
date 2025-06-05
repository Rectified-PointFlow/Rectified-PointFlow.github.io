// --------------------------------------
//  script.js (corrected to avoid
//  “Maximum call stack exceeded”)
// --------------------------------------

// 1) IMPORTS (make sure your bundler or <script type="module"> is set up)
import * as THREE from 'three';
import { PCDLoader } from 'PCDLoader';
import { OrbitControls } from 'OrbitControls';

// 2) SAMPLE MAP + FRAME PARAMETERS
const sampleMap = {
  partnet_78:  ['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19'],
  partnet_652: ['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19'],
  partnet_680: ['1','2','3','4','5','6','7','8','9','10','11','12','13','14','15','16','17','18','19']
};
const totalFrames   = 20;   // steps per sample
const frameInterval = 40;   // ms per frame
const pauseDuration = 2000; // ms to pause at last frame

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

// We will add this “sync guard” so that once we start syncing cameras, 
// we don’t re‐enter the sync routine from within itself.
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
//    When any controls fire a 'change', we read its spherical coords
//    and apply them to all other cameras & controls—BUT only if not already syncing.
function syncAnglesFrom(srcControls) {
  if (isSyncing) return;

  isSyncing = true;
  try {
    const cam = srcControls.object;            // the THREE.Camera of the source
    const target = srcControls.target.clone(); // typically (0,0,0)
    const offset = new THREE.Vector3().copy(cam.position).sub(target);
    const spherical = new THREE.Spherical().setFromVector3(offset);

    allStates.forEach((st) => {
      if (st.controls === srcControls) return; // skip the source itself

      // Recompute position from the same spherical coords around that viewer's target
      const newPos = new THREE.Vector3()
        .setFromSphericalCoords(spherical.radius, spherical.phi, spherical.theta)
        .add(st.controls.target);

      st.camera.position.copy(newPos);
      st.camera.lookAt(st.controls.target);
      st.controls.update(); // this will *not* re‐enter syncAnglesFrom because isSyncing===true
    });
  } finally {
    isSyncing = false;
  }
}

// 7) INITIALIZE A STATIC INPUT VIEWER
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

  // Ground plane
  const planeGeo = new THREE.PlaneGeometry(20, 20);
  const planeMat = new THREE.ShadowMaterial({ opacity: 0.2 });
  const ground = new THREE.Mesh(planeGeo, planeMat);
  ground.rotateX(-Math.PI / 2);
  ground.position.y = -0.45;
  ground.receiveShadow = true;
//   scene.add(ground);

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

  controls.addEventListener('start', () => {
    isPaused = true;
    allStates.forEach((st) => {
      st.controls.autoRotate = false;
    });
  });
  controls.addEventListener('end', () => {
    allStates.forEach((st) => {
      st.controls.autoRotate = true;
    });
    // After finishing a drag, immediately sync camera angles
    syncAnglesFrom(controls);
    isPaused = false;
  });
  controls.addEventListener('change', () => {
    // Only sync cameras during a *user drag*. On autoRotate, we do NOT sync here.
    if (controls.userIsInteracting) {
      syncAnglesFrom(controls);
    }
  });

  // Patch OrbitControls so we know when the user is interacting.
  // By default, OrbitControls doesn't expose a "userIsInteracting" flag, so we set it manually:
  controls.userIsInteracting = false;
  controls.domElement.addEventListener('mousedown', () => {
    controls.userIsInteracting = true;
  });
  document.addEventListener('mouseup', () => {
    controls.userIsInteracting = false;
  });

  // Load the single PCD: `pcd/${objName}/input.pcd`
  const url = `pcd/${objName}/input.pcd`;
  globalLoader.load(
    url,
    (points) => {
      loading.style.display = 'none';
      scene.add(points);
      inputState.mesh = points;
    },
    () => { /* ignore progress */ },
    (err) => {
      console.error(`Error loading input PCD ${url}:`, err);
      loading.innerText = 'Error';
    }
  );

  // Return state
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

  // Ground plane
  const planeGeo = new THREE.PlaneGeometry(20, 20);
  const planeMat = new THREE.ShadowMaterial({ opacity: 0.2 });
  const ground = new THREE.Mesh(planeGeo, planeMat);
  ground.rotateX(-Math.PI / 2);
  ground.position.y = -0.8;
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

  // OrbitControls (with same sync logic)
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0);
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 2;
  controls.update();

  controls.addEventListener('start', () => {
    allStates.forEach((st) => {
      st.controls.autoRotate = false;
    });
  });
  controls.addEventListener('end', () => {
    allStates.forEach((st) => {
      st.controls.autoRotate = true;
    });
    // After finishing a drag, sync cameras
    syncAnglesFrom(controls);
  });
  controls.addEventListener('change', () => {
    if (controls.userIsInteracting) {
      syncAnglesFrom(controls);
    }
  });

  controls.userIsInteracting = false;
  controls.domElement.addEventListener('mousedown', () => {
    controls.userIsInteracting = true;
  });
  document.addEventListener('mouseup', () => {
    controls.userIsInteracting = false;
  });

  // Prepare array for 20 frames
  const frameMeshes = new Array(totalFrames).fill(null);

  const state = {
    container,
    scene,
    camera,
    renderer,
    controls,
    frameMeshes,
    currentSampleId: null,
    loadingOverlay: loading,
    isSampled: true
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

  // Load 20 frames from `sample_${sampleId}/step_t.pcd`
  async function loadSample(sampleId, showLoading = false) {
    if (showLoading) {
      state.loadingOverlay.style.display = 'flex';
    }

    const newMeshes = new Array(totalFrames).fill(null);
    const sphereGeo = new THREE.SphereGeometry(0.01, 6, 6);

    for (let t = 0; t < totalFrames; t++) {
      const url = `pcd/${objName}/sample_${sampleId}/step_${t}.pcd`;
      await new Promise((resolve) => {
        globalLoader.load(
          url,
          (points) => {
            const geom = points.geometry;
            const posAttr = geom.attributes.position;
            const lblAttr = geom.attributes.label;
            if (!posAttr) {
              console.error(`No position attribute in ${url}`);
              resolve();
              return;
            }
            const positions = posAttr.array;
            const N = positions.length / 3;
            const labels = lblAttr ? lblAttr.array : null;

            // Build InstancedMesh of tiny spheres
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

            // Determine max label
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

            // Hide initially
            instMesh.visible = false;
            newMeshes[t] = instMesh;
            state.scene.add(instMesh);

            geom.dispose();
            resolve();
          },
          () => { /* progress ignored */ },
          (err) => {
            console.error(`Error loading ${url}:`, err);
            newMeshes[t] = null;
            resolve();
          }
        );
      });
    }

    // Swap in new meshes
    if (showLoading) {
      state.loadingOverlay.style.display = 'none';
    }
    state.frameMeshes.forEach((oldMesh) => {
      if (oldMesh) {
        state.scene.remove(oldMesh);
        oldMesh.geometry.dispose();
        oldMesh.material.dispose();
      }
    });
    state.frameMeshes = newMeshes;
    state.currentSampleId = sampleId;

    // Show the mesh at currentFrameIdx
    const idx = currentFrameIdx;
    if (state.frameMeshes[idx]) {
      state.frameMeshes[idx].visible = true;
    }
  }

  // Pick initial sample, load it (with loading)
  state.currentSampleId = initialSampleId;
  loadSample(initialSampleId, true);

  state.pickRandom = pickRandomSample;
  state.loadSample = loadSample;

  return state;
}

// 9) TEARDOWN: CLEAR ALL VIEWERS (disposing Three.js objects)
function clearAllViewers() {
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
function advanceAllFrames() {
  if (isPaused) return;

  const idx = currentFrameIdx;
  const prevIdx = (idx - 1 + totalFrames) % totalFrames;

  sampledStates.forEach((st) => {
    if (st.frameMeshes[prevIdx]) st.frameMeshes[prevIdx].visible = false;
    if (st.frameMeshes[idx]) st.frameMeshes[idx].visible = true;
  });

  if (idx === totalFrames - 1) {
    if (autoResample) {
      playTimeoutId = setTimeout(() => {
        const promises = sampledStates.map((st) => {
          const newId = st.pickRandom();
          return st.loadSample(newId, false);
        });
        Promise.all(promises).then(() => {
          if (!isPaused) {
            currentFrameIdx = 0;
            advanceAllFrames();
          }
        });
      }, pauseDuration);
    } else {
      playTimeoutId = setTimeout(() => {
        if (!isPaused) {
          currentFrameIdx = 0;
          advanceAllFrames();
        }
      }, pauseDuration);
    }
  } else {
    playTimeoutId = setTimeout(() => {
      if (!isPaused) {
        currentFrameIdx++;
        advanceAllFrames();
      }
    }, frameInterval);
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
  clearAllViewers();

  // Mark active tab
  document.querySelectorAll('.tab-button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.obj === objName);
  });

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

  // B) “Generation / Point Cloud in Assembled State” (two sampled viewers)
  const assembledBlock = document.createElement('div');
  assembledBlock.style.display = 'flex';
  assembledBlock.style.flexDirection = 'column';
//   assembledBlock.style.flex = '2 1 580px';

  const assembledCaption = document.createElement('div');
  assembledCaption.classList.add('assembled-caption');
  assembledCaption.innerHTML =
    'Generation<hr><span class="assembled-subcaption">Possible Assembed Point Clouds</span>';
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
  advanceAllFrames();
}

// 13) HOOK UP TAB BUTTONS ONCE DOM IS READY
window.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.tab-button').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectObject(btn.dataset.obj);
    });
  });

  // Show the first object by default
  selectObject('partnet_78');

  // Start the render loop
  animateAll();
});
