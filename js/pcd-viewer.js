import * as THREE from 'three';
import { PCDLoader } from 'PCDLoader';


const sampleMap = {
    partnet_78: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19'],
};

const totalFrames   = 20;   // steps per sample
const frameInterval = 50;   // ms per frame → 20 fps

// Convert HSV to RGB (h, s, v ∈ [0,1])
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

// Retrieve all viewer elements
const viewerElems = Array.from(document.querySelectorAll('.viewer'));
const viewers = []; // will hold per-viewer state

// Global playback state
let isPaused = false;
let autoResample = true;
let currentFrameIdx = 0;
let playTimeoutId = null;

// Global controls
const btnPlayPause    = document.getElementById('btn-playpause');
const btnAutoResample = document.getElementById('btn-autoresample');

// Initialize each viewer: scene, camera, renderer, lights, overlays
viewerElems.forEach((container) => {
    const objName = container.dataset.obj;
    if (!sampleMap[objName] || sampleMap[objName].length === 0) {
    console.error(`No samples for "${objName}".`);
    return;
    }

    // Per-viewer state object
    const state = {
    container,
    objName,
    scene: null,
    camera: null,
    renderer: null,
    frameMeshes: new Array(totalFrames).fill(null),
    currentSampleId: null,
    loadingOverlay: container.querySelector('.loading')
    };

    // Build scene + camera + renderer + lights + ground
    function initViewer() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xF5F5F5);

    const aspect = container.clientWidth / container.clientHeight;
    const camera = new THREE.PerspectiveCamera(25, aspect, 0.1, 1000);
    camera.position.set(0, 1.5, 5);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // Ambient light
    const ambient = new THREE.AmbientLight(0xffffff, 1.0);
    scene.add(ambient);

    // Directional light
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
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

    // Ground plane (receive shadows)
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

    state.scene = scene;
    state.camera = camera;
    state.renderer = renderer;
    }

    // Pick a random sample ID ≠ last one
    function pickRandomSample() {
    const arr = sampleMap[objName];
    if (arr.length === 1) return arr[0];
    let choice;
    do {
        choice = arr[Math.floor(Math.random() * arr.length)];
    } while (choice === state.currentSampleId);
    return choice;
    }

    // Load all 20 frames for a given sampleId
    // If showLoading=true, display overlay; otherwise, load silently
    async function loadSample(sampleId, showLoading = false) {
    if (showLoading) {
        state.loadingOverlay.style.display = 'flex';
    }

    // Remove old meshes
    state.frameMeshes.forEach((instMesh) => {
        if (instMesh) {
        state.scene.remove(instMesh);
        instMesh.geometry.dispose();
        instMesh.material.dispose();
        }
    });
    state.frameMeshes = new Array(totalFrames).fill(null);

    const loader = new PCDLoader();
    const sphereGeo = new THREE.SphereGeometry(0.01, 6, 6);

    for (let t = 0; t < totalFrames; t++) {
        const url = `pcd/${objName}/sample_${sampleId}/step_${t}.pcd`;
        await new Promise((resolve) => {
        loader.load(
            url,
            (points) => {
            const geom    = points.geometry;
            const posAttr = geom.attributes.position;
            const lblAttr = geom.attributes.label;
            if (!posAttr) {
                console.error(`No position in ${url}`);
                resolve(); return;
            }
            const positions = posAttr.array;
            const N = positions.length / 3;
            let labels = null;
            if (lblAttr) labels = lblAttr.array;

            // Build InstancedMesh of spheres
            const mat = new THREE.MeshStandardMaterial({
                transparent: true,
                metalness: 0.2,
                roughness: 0.5
            });
            const instMesh = new THREE.InstancedMesh(sphereGeo, mat, N);
            instMesh.castShadow = true;
            instMesh.receiveShadow = false;

            const dummyMatrix = new THREE.Matrix4();
            const color = new THREE.Color();

            // Find max label
            let maxLabel = 0;
            if (labels) {
                for (let i = 0; i < N; i++) {
                if (labels[i] > maxLabel) maxLabel = labels[i];
                }
            }

            for (let i = 0; i < N; i++) {
                const x = positions[3*i];
                const y = positions[3*i + 1];
                const z = positions[3*i + 2];
                dummyMatrix.makeTranslation(x, y, z);
                instMesh.setMatrixAt(i, dummyMatrix);

                if (labels) {
                const lbl = labels[i];
                const hue = maxLabel > 0 ? (lbl / maxLabel) * 0.8 : 0;
                const [r, g, b] = hsvToRgb(hue, 0.75, 0.6);
                color.setRGB(r, g, b);
                } else {
                color.setRGB(0.5, 0.5, 0.5);
                }
                instMesh.setColorAt(i, color);
            }

            instMesh.visible = false;
            state.frameMeshes[t] = instMesh;
            state.scene.add(instMesh);

            geom.dispose();
            resolve();
            },
            () => { /* progress ignored */ },
            (err) => {
            console.error(`Error loading ${url}:`, err);
            state.frameMeshes[t] = null;
            resolve();
            }
        );
        });
    }

    if (showLoading) {
        state.loadingOverlay.style.display = 'none';
    }
    }

    // Store methods & data in state, then initialize
    state.initViewer   = initViewer;
    state.pickRandom   = pickRandomSample;
    state.loadSample   = loadSample;

    initViewer();
    viewers.push(state);
});

// After all viewers initialized, load each’s initial sample, then start loop
async function startAll() {
    // Pick & load initial sample for each (show loading)
    const loadPromises = viewers.map((v) => {
    v.currentSampleId = v.pickRandom();
    return v.loadSample(v.currentSampleId, true);
    });
    await Promise.all(loadPromises);

    currentFrameIdx = 0;
    advanceAllFrames();
    animateAll(); // start render loop
}

// Advance one frame across all viewers in sync
function advanceAllFrames() {
    if (isPaused) return;

    const idx     = currentFrameIdx;
    const prevIdx = (idx - 1 + totalFrames) % totalFrames;

    // Hide previous & show current for each viewer
    viewers.forEach((v) => {
    if (v.frameMeshes[prevIdx]) v.frameMeshes[prevIdx].visible = false;
    if (v.frameMeshes[idx])      v.frameMeshes[idx].visible = true;
    });

    if (idx === totalFrames - 1) {
    // Last frame: pause 1s, then either loop or resample
    if (autoResample) {
        // Start silent loading
        // After 1s, wait for loading to finish before continuing
        playTimeoutId = setTimeout(() => {
            const loadPromises = viewers.map((v) => {
                v.currentSampleId = v.pickRandom();
                return v.loadSample(v.currentSampleId, false);
            });
            console.log('Resampling to new samples...');
            Promise.all(loadPromises).then(() => {
                if (!isPaused) {
                currentFrameIdx = 0;
                advanceAllFrames();
                }
            });
        }, 1000);
    } else {
        // Just pause 1s then loop same frames
        playTimeoutId = setTimeout(() => {
        if (!isPaused) {
            currentFrameIdx = 0;
            advanceAllFrames();
        }
        }, 1000);
    }
    } else {
    // Normal frame advance
    playTimeoutId = setTimeout(() => {
        if (!isPaused) {
        currentFrameIdx++;
        advanceAllFrames();
        }
    }, frameInterval);
    }
}

// Render loop for all viewers
function animateAll() {
    requestAnimationFrame(animateAll);
    const angle = Date.now() * 0.0005; // continuous orbit
    const radius = 5;
    viewers.forEach((v) => {
    const cam = v.camera;
    cam.position.x = radius * Math.sin(angle);
    cam.position.y = 1.5;
    cam.position.z = radius * Math.cos(angle);
    cam.lookAt(0, 0, 0);
    v.renderer.render(v.scene, cam);
    });
}

// Play/Pause toggle
function togglePlayPause() {
    if (isPaused) {
    isPaused = false;
    btnPlayPause.innerHTML = '⏸️ <span>Pause</span>';
    advanceAllFrames();
    } else {
    isPaused = true;
    btnPlayPause.innerHTML = '▶️ <span>Play</span>';
    clearTimeout(playTimeoutId);
    }
}

// Auto-resample toggle
function toggleAutoResample() {
    autoResample = !autoResample;
    if (autoResample) {
    btnAutoResample.innerHTML = '🔄 <span>Re-sample: On</span>';
    } else {
    btnAutoResample.innerHTML = '❌ <span>Re-sample: Off</span>';
    }
}

// Hook up global buttons
btnPlayPause.addEventListener('click', () => {
    togglePlayPause();
});
btnAutoResample.addEventListener('click', () => {
    toggleAutoResample();
});

// Kick off initial loading and playback
startAll();