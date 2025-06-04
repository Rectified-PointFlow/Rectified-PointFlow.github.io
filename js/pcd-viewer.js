import * as THREE from 'three';
import { PCDLoader } from 'PCDLoader';


const sampleMap = {
    partnet_78: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12', '13', '14', '15', '16', '17', '18', '19'],
};

// Number of time‐steps per sample
const totalFrames = 20;
// How fast to play (in ms). 50ms → 20 fps
const frameInterval = 50;

// HSV → RGB helper: h ∈ [0,1], s ∈ [0,1], v ∈ [0,1]
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

document.querySelectorAll('.viewer').forEach((container) => {
    const objName = container.dataset.obj;
    if (!sampleMap[objName] || sampleMap[objName].length === 0) {
    console.error(`No sample IDs listed for object "${objName}".`);
    return;
    }

    let scene, camera, renderer;
    let frameMeshes = new Array(totalFrames).fill(null);
    let currentSampleId = null;
    let currentFrameIdx = 0;
    let playTimeoutId = null;
    let angle = 0;            // for camera rotation
    let isPaused = false;     // pause/play state

    const btnPlayPause = container.querySelector('.btn-playpause');
    // const btnResample   = container.querySelector('.btn-resample');

    // Helper: pick a random sample ID, different from last time
    function pickRandomSample() {
    const arr = sampleMap[objName];
    if (arr.length === 1) return arr[0];
    let choice;
    do {
        choice = arr[Math.floor(Math.random() * arr.length)];
    } while (choice === currentSampleId);
    return choice;
    }

    // Initialize scene + camera + renderer + lights + ground
    function initViewer() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xF5F5F5);

    const fov = 25; // as in original code snippet
    const aspect = container.clientWidth / container.clientHeight;
    camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 1000);
    camera.position.set(0, 1.5, 5);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);

    // Ambient Light
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.0);
    scene.add(ambientLight);

    // Directional Light with shadows
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

    // Ground plane to receive shadows
    const planeGeo = new THREE.PlaneGeometry(20, 20);
    const planeMat = new THREE.ShadowMaterial({ opacity: 0.2 });
    const ground = new THREE.Mesh(planeGeo, planeMat);
    ground.rotateX(-Math.PI / 2);
    ground.position.y = -0.8;
    ground.receiveShadow = true;
    scene.add(ground);

    // On resize
    window.addEventListener('resize', () => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        renderer.setSize(w, h);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
    });
    }

    // Load all frames for a given sample
    async function loadSample(sampleId) {
    // Remove and dispose old meshes
    frameMeshes.forEach((instMesh) => {
        if (instMesh) {
        scene.remove(instMesh);
        instMesh.geometry.dispose();
        instMesh.material.dispose();
        }
    });
    frameMeshes = new Array(totalFrames).fill(null);

    const loader = new PCDLoader();
    const sphereGeom = new THREE.SphereGeometry(0.01, 6, 6);

    for (let t = 0; t < totalFrames; t++) {
        const url = `pcd/${objName}/sample_${sampleId}/step_${t}.pcd`;
        await new Promise((resolve) => {
        loader.load(
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
            let labels = null;
            if (lblAttr) labels = lblAttr.array; // Uint32Array

            // Create InstancedMesh: one sphere per point
            const mat = new THREE.MeshStandardMaterial({
                transparent: true,
                metalness: 0.2,
                roughness: 0.5,
            });
            const instMesh = new THREE.InstancedMesh(sphereGeom, mat, N);
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
                // Map label to hue in [0,0.8]
                const hue = maxLabel > 0 ? (lbl / maxLabel) * 0.8 : 0;
                // Slightly higher saturation (0.75), moderate value (0.6)
                const [r, g, b] = hsvToRgb(hue, 0.75, 0.6);
                color.setRGB(r, g, b);
                } else {
                color.setRGB(0.5, 0.5, 0.5);
                }
                instMesh.setColorAt(i, color);
            }

            instMesh.visible = false;
            frameMeshes[t] = instMesh;
            scene.add(instMesh);
            geom.dispose();
            resolve();
            },
            (xhr) => { /* optional progress */ },
            (err) => {
            console.error(`Error loading ${url}:`, err);
            frameMeshes[t] = null;
            resolve();
            }
        );
        });
    }
    console.log(`✅ Loaded all frames for "${objName}" → sample_${sampleId}`);
    }

    // Play or resume animation loop
    function playAnimationLoop() {
    isPaused = false;
    btnPlayPause.textContent = '⏸'; // show pause icon when playing
    frameMeshes.forEach((m) => { if (m) m.visible = false; });
    currentFrameIdx = 0;
    advanceFrame();
    }

    // Advance one frame (handles auto-resample at end)
    function advanceFrame() {
    if (isPaused) return; // don’t advance if paused

    const shownIdx = currentFrameIdx;
    const prevIdx = (currentFrameIdx - 1 + totalFrames) % totalFrames;
    if (frameMeshes[prevIdx]) frameMeshes[prevIdx].visible = false;
    if (frameMeshes[shownIdx]) frameMeshes[shownIdx].visible = true;

    currentFrameIdx = (currentFrameIdx + 1) % totalFrames;

    if (shownIdx === totalFrames - 1) {
        // Last frame: pause 1s then auto-resample
        playTimeoutId = setTimeout(() => {
        if (!isPaused) resample();
        }, 1000);
    } else {
        playTimeoutId = setTimeout(() => {
        if (!isPaused) advanceFrame();
        }, frameInterval);
    }
    }

    // Pause or resume toggle
    function togglePause() {
    if (isPaused) {
        // Resume
        playAnimationLoop();
    } else {
        // Pause
        isPaused = true;
        btnPlayPause.textContent = '▶'; // show play icon when paused
        clearTimeout(playTimeoutId);
    }
    }

    // Resample (pick new sample, reload, and play)
    async function resample() {
    isPaused = false;
    btnPlayPause.textContent = '⏸';
    clearTimeout(playTimeoutId);
    currentSampleId = pickRandomSample();
    console.log(`🔄 [${objName}] Loading sample_${currentSampleId} …`);
    await loadSample(currentSampleId);
    playAnimationLoop();
    }

    // Render loop: rotate camera and draw
    function animate() {
    requestAnimationFrame(animate);
    angle += 0.002;
    const radius = 5;
    camera.position.x = radius * Math.sin(angle);
    camera.position.y = 1.5; 
    camera.position.z = radius * Math.cos(angle);
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
    }

    // Initialization
    initViewer();
    currentSampleId = pickRandomSample();
    console.log(`🛫 [${objName}] Initial sample_${currentSampleId}`);
    loadSample(currentSampleId).then(() => {
    playAnimationLoop();
    });
    animate();

    // Hook up buttons
    btnPlayPause.addEventListener('click', (e) => {
    e.stopPropagation(); // prevent container click
    togglePause();
    });
    // btnResample.addEventListener('click', (e) => {
    // e.stopPropagation();
    // resample();
    // });
});