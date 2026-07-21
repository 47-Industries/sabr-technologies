/**
 * Brain3D — original Leon viz, restored verbatim.
 *
 * Only two diffs from the pristine upstream:
 *
 *   1. REGION_LAYOUT/COLORS/CONNECTIONS swapped to the current 18-region
 *      anatomical brain (the sim now sends 18 regions instead of the
 *      original's 11 ML-style names). Each region gets its own unique
 *      color so no two clusters share a hue.
 *
 *   2. Per-region labels removed. In their place, 5 PC-hardware sector
 *      labels (CPU / MEM / DISK / SENSE / OUT) drawn in the original's
 *      bordered-pill style, anchored at well-spread 3D points.
 *
 * Everything else — particle clouds at real neuron positions, ambient
 * glow halos, signal arcs spawning from real region firing, constant
 * slow autorotate, bloom tuning — is the original.
 */
import * as THREE from 'three';
import { OrbitControls   } from 'three/addons/controls/OrbitControls.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { EffectComposer  } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass      } from 'three/addons/postprocessing/RenderPass.js';

// ── 7 lobe colors: red, orange, pink, green, yellow, purple, white ──────
// Every region within an anatomical lobe shares that lobe's color, so
// the field reads as exactly 7 distinct color zones — one per lobe.
const LOBE_COLOR_RED    = 0xff3344;   // frontal
const LOBE_COLOR_ORANGE = 0xff9933;   // parietal
const LOBE_COLOR_PINK   = 0xff66bb;   // temporal
const LOBE_COLOR_GREEN  = 0x44ff77;   // occipital
const LOBE_COLOR_YELLOW = 0xffdd33;   // limbic
const LOBE_COLOR_PURPLE = 0xaa55ff;   // subcortical
const LOBE_COLOR_BLUE   = 0x00ccdd;   // hindbrain — turquoise blue

const REGION_COLORS = {
    // FRONTAL LOBE — red
    prefrontal_cortex:    LOBE_COLOR_RED,
    anterior_cingulate:   LOBE_COLOR_RED,
    motor_cortex:         LOBE_COLOR_RED,
    broca:                LOBE_COLOR_RED,
    // PARIETAL LOBE — orange
    parietal_association: LOBE_COLOR_ORANGE,
    somatosensory_cortex: LOBE_COLOR_ORANGE,
    // TEMPORAL LOBE — pink
    temporal_association: LOBE_COLOR_PINK,
    auditory_cortex:      LOBE_COLOR_PINK,
    wernicke:             LOBE_COLOR_PINK,
    // OCCIPITAL LOBE — green
    visual_cortex:        LOBE_COLOR_GREEN,
    // LIMBIC SYSTEM — yellow
    hippocampus:          LOBE_COLOR_YELLOW,
    amygdala:             LOBE_COLOR_YELLOW,
    insula:               LOBE_COLOR_YELLOW,
    // SUBCORTICAL — purple
    thalamus:             LOBE_COLOR_PURPLE,
    basal_ganglia:        LOBE_COLOR_PURPLE,
    default_mode_network: LOBE_COLOR_PURPLE,
    // HINDBRAIN — white (cerebellum + brainstem merged)
    cerebellum:           LOBE_COLOR_BLUE,
    brainstem:            LOBE_COLOR_BLUE,
};

// ── Region layout — wider lateral spread to match the original's shape.
// Original (11-region) had X range -0.9..+1.0 — regions stuck out
// laterally like real brain lobes. The previous 18-region map clustered
// most regions on the centerline (X≈0), which made the blob taller and
// narrower than the original. This layout restores the lateral spread.
const REGION_LAYOUT = {
    // Frontal — top, asymmetric (language dominance on the left)
    prefrontal_cortex:    { x: -0.45, y:  0.95, z:  0.20 },
    anterior_cingulate:   { x:  0.10, y:  0.65, z:  0.00 },
    motor_cortex:         { x:  0.45, y:  0.85, z:  0.20 },
    broca:                { x: -0.75, y:  0.45, z:  0.30 },
    // Parietal / lateral
    parietal_association: { x:  0.30, y:  0.20, z:  0.45 },
    somatosensory_cortex: { x:  0.60, y:  0.40, z:  0.45 },
    auditory_cortex:      { x:  0.90, y: -0.05, z:  0.05 },
    temporal_association: { x: -0.90, y: -0.05, z:  0.00 },
    wernicke:             { x: -0.65, y: -0.35, z:  0.30 },
    insula:               { x:  0.50, y:  0.10, z: -0.25 },
    // Subcortical / deep
    thalamus:             { x:  0.05, y:  0.05, z:  0.00 },
    basal_ganglia:        { x:  0.25, y:  0.25, z: -0.10 },
    hippocampus:          { x: -0.40, y: -0.35, z: -0.10 },
    amygdala:             { x:  0.35, y: -0.10, z: -0.30 },
    default_mode_network: { x: -0.10, y:  0.30, z:  0.15 },
    // Posterior / inferior
    visual_cortex:        { x:  0.05, y: -0.85, z:  0.10 },
    cerebellum:           { x:  0.10, y: -0.75, z: -0.40 },
    brainstem:            { x:  0.00, y: -0.55, z: -0.55 },
};

// ── Anatomically-motivated connectome (for signal arcs + graph view) ────
const CONNECTIONS = [
    ['visual_cortex',         'thalamus'],
    ['auditory_cortex',       'thalamus'],
    ['somatosensory_cortex',  'thalamus'],
    ['thalamus',              'prefrontal_cortex'],
    ['visual_cortex',         'temporal_association'],
    ['somatosensory_cortex',  'parietal_association'],
    ['parietal_association',  'prefrontal_cortex'],
    ['temporal_association',  'prefrontal_cortex'],
    ['parietal_association',  'hippocampus'],
    ['hippocampus',           'prefrontal_cortex'],
    ['amygdala',              'prefrontal_cortex'],
    ['amygdala',              'hippocampus'],
    ['amygdala',              'insula'],
    ['anterior_cingulate',    'prefrontal_cortex'],
    ['wernicke',              'broca'],
    ['broca',                 'motor_cortex'],
    ['prefrontal_cortex',     'basal_ganglia'],
    ['basal_ganglia',         'thalamus'],
    ['motor_cortex',          'cerebellum'],
    ['cerebellum',            'motor_cortex'],
    ['brainstem',             'thalamus'],
    ['default_mode_network',  'prefrontal_cortex'],
];

// ── Anatomical lobe groupings (replaces PC sector labels) ───────────────
// Each region maps to one of the 8 standard anatomical groupings used in
// neuroscience textbooks. This is what the labels in the UI display.
const SECTOR_OF_REGION = {
    prefrontal_cortex:    'frontal',
    anterior_cingulate:   'frontal',
    motor_cortex:         'frontal',
    broca:                'frontal',
    parietal_association: 'parietal',
    somatosensory_cortex: 'parietal',
    temporal_association: 'temporal',
    auditory_cortex:      'temporal',
    wernicke:             'temporal',
    visual_cortex:        'occipital',
    hippocampus:          'limbic',
    amygdala:             'limbic',
    insula:               'limbic',
    thalamus:             'subcortical',
    basal_ganglia:        'subcortical',
    default_mode_network: 'subcortical',
    cerebellum:           'hindbrain',
    brainstem:            'hindbrain',
};

// Anchor positions chosen so each label sits *outside* its lobe's
// underlying region cloud rather than dead-center inside it — keeps
// the labels from getting buried in particles.
// Lobe pill accents — neutral white-ish so they read against any of the
// 18 vivid region colors underneath. Anchored OUTSIDE each lobe so the
// labels don't bury the particles.
// Each pill's accent stripe matches its lobe color so labels visually
// belong with their underlying particle clouds. Cerebellum + brainstem
// merged into one HINDBRAIN label so we land on exactly 7 colors.
const SECTOR_LABELS = {
    frontal:     { label: 'FRONTAL LOBE',   accent: LOBE_COLOR_RED,
                   anchor: [ 0.00,  1.15,  0.30],
                   desc: 'Executive · planning · motor · speech' },
    parietal:    { label: 'PARIETAL LOBE',  accent: LOBE_COLOR_ORANGE,
                   anchor: [ 0.95,  0.65,  0.40],
                   desc: 'Spatial awareness · touch · integration' },
    temporal:    { label: 'TEMPORAL LOBE',  accent: LOBE_COLOR_PINK,
                   anchor: [-1.15, -0.15,  0.20],
                   desc: 'Hearing · language · recognition' },
    occipital:   { label: 'OCCIPITAL LOBE', accent: LOBE_COLOR_GREEN,
                   anchor: [ 0.55, -1.05,  0.20],
                   desc: 'Visual processing' },
    limbic:      { label: 'LIMBIC SYSTEM',  accent: LOBE_COLOR_YELLOW,
                   anchor: [-0.65, -0.55, -0.10],
                   desc: 'Memory · emotion · interoception' },
    subcortical: { label: 'SUBCORTICAL',    accent: LOBE_COLOR_PURPLE,
                   anchor: [ 0.80,  0.20, -0.40],
                   desc: 'Thalamus · basal ganglia · DMN' },
    hindbrain:   { label: 'HINDBRAIN',      accent: LOBE_COLOR_BLUE,
                   anchor: [ 0.00, -0.95, -0.55],
                   desc: 'Cerebellum · brain stem · arousal' },
};

function createNeuronTexture() {
    const size = 64;
    const canvas = document.createElement('canvas');
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext('2d');
    const half = size / 2;
    const g = ctx.createRadialGradient(half, half, 0, half, half, half);
    g.addColorStop(0,    'rgba(255,255,255,1.0)');
    g.addColorStop(0.15, 'rgba(255,255,255,0.8)');
    g.addColorStop(0.4,  'rgba(255,255,255,0.3)');
    g.addColorStop(0.7,  'rgba(255,255,255,0.05)');
    g.addColorStop(1,    'rgba(255,255,255,0.0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new THREE.CanvasTexture(canvas);
    tex.needsUpdate = true;
    return tex;
}

export class Brain3D {
    constructor(container) {
        this.container = container;
        this.time = 0;
        this.regionMeshes = {};
        this.regionGlows = {};
        this.regionData = {};
        this.labels = {};                  // sectorId → element
        this.lastState = null;
        this.graphView = false;

        // Signal particles for "thinking" visualization (original)
        this.signals = [];
        this.maxSignals = 150;

        // Per-sector firing rollup (for label stats)
        this.sectorFiring = {};

        // ── Scene (original)
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x020408);

        // ── Camera (original)
        this.camera = new THREE.PerspectiveCamera(
            55, window.innerWidth / window.innerHeight, 0.01, 100
        );
        this.camera.position.set(0, 0.3, 3.5);

        // ── Renderer (original)
        this.renderer = new THREE.WebGLRenderer({
            antialias: true, alpha: true, powerPreference: 'high-performance',
            failIfMajorPerformanceCaveat: false,
        });
        this.renderer.setSize(window.innerWidth, window.innerHeight);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.1;
        container.appendChild(this.renderer.domElement);

        // ── WebGL context loss recovery ──
        // Brave/Chrome aggressively kills WebGL contexts when tabs are
        // backgrounded or GPU pressure is high. Without this, the brain
        // goes black and never comes back.
        const canvas = this.renderer.domElement;
        canvas.addEventListener('webglcontextlost', (e) => {
            e.preventDefault();
            console.warn('[Brain3D] WebGL context lost — will restore on recovery');
            this._contextLost = true;
        });
        canvas.addEventListener('webglcontextrestored', () => {
            console.log('[Brain3D] WebGL context restored — rebuilding renderer');
            this._contextLost = false;
            // Re-init the renderer state
            this.renderer.setSize(window.innerWidth, window.innerHeight);
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
            this.renderer.toneMappingExposure = 1.1;
        });
        this._contextLost = false;

        // ── Bloom (original)
        this.composer = new EffectComposer(this.renderer);
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        this.bloomPass = new UnrealBloomPass(
            new THREE.Vector2(window.innerWidth, window.innerHeight),
            0.48, 0.30, 0.42
        );
        this.composer.addPass(this.bloomPass);

        // ── Controls (original constant autorotate)
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.rotateSpeed = 0.5;
        this.controls.autoRotate = true;
        this.controls.autoRotateSpeed = 0.2;
        this.controls.target.set(0, 0.1, 0);
        this.controls.minDistance = 2.0;
        this.controls.maxDistance = 15;

        // ── Lights (original)
        this.scene.add(new THREE.AmbientLight(0x111133, 0.3));
        const centerLight = new THREE.PointLight(0x2244aa, 0.6, 8);
        centerLight.position.set(0, 0.2, 0);
        this.scene.add(centerLight);

        // ── Label container
        this.labelContainer = document.createElement('div');
        this.labelContainer.id = 'region-labels';
        this.labelContainer.style.cssText =
            'position:fixed;top:0;left:0;width:100%;height:100%;' +
            'pointer-events:none;z-index:5;';
        document.body.appendChild(this.labelContainer);

        // ── Graph view button (original)
        this._createGraphViewButton();

        // Neuron texture
        this.neuronTexture = createNeuronTexture();

        // Signal particle system (original)
        this._initSignalSystem();

        // Build the 5 sector pills now (independent of sim data)
        this._buildSectorLabels();

        // Resize
        window.addEventListener('resize', () => this._onResize());

        // Raycaster (original)
        this.raycaster = new THREE.Raycaster();
        this.raycaster.params.Points = { threshold: 0.08 };
        this.mouse = new THREE.Vector2();
        container.addEventListener('click', (e) => this._onClick(e));
    }

    // ===================== SIGNAL PARTICLES (ORIGINAL) =====================

    _initSignalSystem() {
        const geometry = new THREE.BufferGeometry();
        const positions = new Float32Array(this.maxSignals * 3);
        const colors    = new Float32Array(this.maxSignals * 3);
        const sizes     = new Float32Array(this.maxSignals);

        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color',    new THREE.BufferAttribute(colors,    3));
        geometry.setAttribute('size',     new THREE.BufferAttribute(sizes,     1));

        const material = new THREE.PointsMaterial({
            size: 0.03, map: this.neuronTexture,
            transparent: true, opacity: 0.9,
            blending: THREE.AdditiveBlending, depthWrite: false,
            sizeAttenuation: true, vertexColors: true,
        });

        this.signalMesh = new THREE.Points(geometry, material);
        this.scene.add(this.signalMesh);

        for (let i = 0; i < this.maxSignals; i++) {
            this.signals.push({
                active: false,
                from: new THREE.Vector3(),
                to:   new THREE.Vector3(),
                pos:  new THREE.Vector3(),
                progress: 0, speed: 0,
                color: new THREE.Color(),
            });
        }
    }

    _spawnSignal(fromRegion, toRegion, color) {
        const from = REGION_LAYOUT[fromRegion];
        const to   = REGION_LAYOUT[toRegion];
        if (!from || !to) return;
        for (const sig of this.signals) {
            if (!sig.active) {
                sig.active = true;
                sig.from.set(from.x, from.y, from.z);
                sig.to.set(to.x, to.y, to.z);
                sig.pos.copy(sig.from);
                sig.progress = 0;
                sig.speed = 0.4 + Math.random() * 0.8;
                sig.color.set(color);
                sig.mid = new THREE.Vector3(
                    (from.x + to.x) / 2 + (Math.random() - 0.5) * 0.3,
                    (from.y + to.y) / 2 + (Math.random() - 0.5) * 0.3,
                    (from.z + to.z) / 2 + (Math.random() - 0.5) * 0.3,
                );
                return;
            }
        }
    }

    _updateSignals(dt) {
        const posArr = this.signalMesh.geometry.attributes.position.array;
        const colArr = this.signalMesh.geometry.attributes.color.array;
        for (let i = 0; i < this.maxSignals; i++) {
            const sig = this.signals[i];
            if (!sig.active) {
                posArr[i*3] = 0; posArr[i*3+1] = -100; posArr[i*3+2] = 0;
                continue;
            }
            sig.progress += dt * sig.speed;
            if (sig.progress >= 1) {
                sig.active = false; posArr[i*3+1] = -100; continue;
            }
            const t = sig.progress, t1 = 1 - t;
            sig.pos.x = t1*t1 * sig.from.x + 2*t1*t * sig.mid.x + t*t * sig.to.x;
            sig.pos.y = t1*t1 * sig.from.y + 2*t1*t * sig.mid.y + t*t * sig.to.y;
            sig.pos.z = t1*t1 * sig.from.z + 2*t1*t * sig.mid.z + t*t * sig.to.z;
            posArr[i*3]   = sig.pos.x;
            posArr[i*3+1] = sig.pos.y;
            posArr[i*3+2] = sig.pos.z;
            colArr[i*3]   = sig.color.r;
            colArr[i*3+1] = sig.color.g;
            colArr[i*3+2] = sig.color.b;
        }
        this.signalMesh.geometry.attributes.position.needsUpdate = true;
        this.signalMesh.geometry.attributes.color.needsUpdate    = true;
    }

    // ===================== NEURON INITIALIZATION (ORIGINAL) =====================

    initNeurons(positions) {
        for (const mesh of Object.values(this.regionMeshes)) this.scene.remove(mesh);
        for (const glow of Object.values(this.regionGlows)) this.scene.remove(glow);
        this.regionMeshes = {};
        this.regionGlows = {};
        this.regionData = positions;
        this._basePositions = {};

        for (const [regionName, regionInfo] of Object.entries(positions)) {
            const pts = regionInfo.positions;
            if (!pts || pts.length === 0) continue;

            const layout = REGION_LAYOUT[regionName] || { x: 0, y: 0, z: 0 };
            const center = regionInfo.center || [0, 0, 0];

            const geometry = new THREE.BufferGeometry();

            // Two input shapes supported:
            //   - Float32Array(n*3) of [x0,y0,z0, x1,y1,z1, ...]  (binary fast path)
            //   - Array of [x,y,z] triplets  (legacy JSON shape)
            // The fast path is what get_neuron_positions_binary() ships;
            // legacy is kept as a fallback for any non-WS caller.
            let nPoints;
            let posArray;
            if (pts instanceof Float32Array) {
                nPoints = (pts.length / 3) | 0;
                posArray = new Float32Array(nPoints * 3);
                // Per-region transform: (pos - center) * 1.2 + layout
                const cx = center[0], cy = center[1], cz = center[2];
                const lx = layout.x,  ly = layout.y,  lz = layout.z;
                for (let i = 0; i < nPoints; i++) {
                    posArray[i*3]     = (pts[i*3]     - cx) * 1.2 + lx;
                    posArray[i*3 + 1] = (pts[i*3 + 1] - cy) * 1.2 + ly;
                    posArray[i*3 + 2] = (pts[i*3 + 2] - cz) * 1.2 + lz;
                }
            } else {
                nPoints = pts.length;
                posArray = new Float32Array(nPoints * 3);
                for (let i = 0; i < nPoints; i++) {
                    posArray[i*3]     = (pts[i][0] - center[0]) * 1.2 + layout.x;
                    posArray[i*3 + 1] = (pts[i][1] - center[1]) * 1.2 + layout.y;
                    posArray[i*3 + 2] = (pts[i][2] - center[2]) * 1.2 + layout.z;
                }
            }
            geometry.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
            this._basePositions[regionName] = new Float32Array(posArray);

            const color = REGION_COLORS[regionName] || 0xffffff;

            // Main neurons — round orbs
            const material = new THREE.PointsMaterial({
                color, size: 0.012, map: this.neuronTexture,
                transparent: true, opacity: 1.0,
                blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
            });
            const points = new THREE.Points(geometry, material);
            points.userData = { regionName, count: regionInfo.count };
            this.scene.add(points);
            this.regionMeshes[regionName] = points;

            // Glow halo (the ambient presence the original had)
            const glowGeometry = geometry.clone();
            const glowMaterial = new THREE.PointsMaterial({
                color, size: 0.035, map: this.neuronTexture,
                transparent: true, opacity: 0.16,
                blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true,
            });
            const glowPoints = new THREE.Points(glowGeometry, glowMaterial);
            this.scene.add(glowPoints);
            this.regionGlows[regionName] = glowPoints;
        }
        console.log(`[Brain3D] Initialized ${Object.keys(this.regionMeshes).length} region clouds`);
    }

    // ===================== SECTOR LABELS (replace original per-region labels) ===

    _buildSectorLabels() {
        for (const id of Object.keys(SECTOR_LABELS)) {
            const meta = SECTOR_LABELS[id];
            const accent = '#' + meta.accent.toString(16).padStart(6, '0');
            const el = document.createElement('div');
            el.className = 'sector-label-3d';
            el.dataset.sectorId = id;
            // Original Leon pill style: small horizontal rectangle,
            // dark backdrop with blur, thin lobe-colored border, no letter-
            // spacing so the name stays narrow → rectangle, not square.
            el.innerHTML = `
                <div class="sec-name" style="color:${accent};font-weight:600;font-size:10px;line-height:1.15;">${meta.label}</div>
                <div class="sec-stats" style="color:${accent};opacity:0.75;font-size:8.5px;line-height:1.15;font-variant-numeric:tabular-nums;">— · idle</div>
            `;
            el.style.cssText = `
                position: absolute; pointer-events: auto; cursor: pointer;
                padding: 4px 10px;
                background: rgba(0,0,0,0.55);
                backdrop-filter: blur(4px);
                -webkit-backdrop-filter: blur(4px);
                border: 1px solid ${accent}55;
                border-radius: 4px;
                font-family: 'JetBrains','Consolas',monospace;
                white-space: nowrap;
                transition: opacity 0.3s, border-color 0.3s;
            `;
            el.addEventListener('click', () => {
                window.dispatchEvent(new CustomEvent('regionClick', {
                    detail: {
                        name: meta.label,
                        color: accent.replace('#', ''),
                        description: meta.desc,
                    },
                }));
            });
            this.labelContainer.appendChild(el);
            this.labels[id] = el;
            el._center = new THREE.Vector3(...meta.anchor);
        }
    }

    // Stat string with FIXED character width so changing values can never
    // shift the label box left/right. Tabular monospace + padded numerics:
    // both fields render at constant width regardless of value.
    _sectorStats(id) {
        const fire = this.sectorFiring[id] || 0;
        const pct  = fire * 100;
        const hz   = (fire * 1000) | 0;
        const pctStr = pct.toFixed(1).padStart(5, ' ') + '%';  // ' 12.4%' always 6 chars
        const hzStr  = String(hz).padStart(3, ' ')     + ' Hz'; // '  4 Hz' always 6 chars
        return `${pctStr} · ${hzStr}`;
    }

    _updateLabelPositions() {
        const W = window.innerWidth, H = window.innerHeight;

        // First pass: project all sector anchors to screen space
        const projected = {};
        for (const [id, el] of Object.entries(this.labels)) {
            const p = el._center.clone().project(this.camera);
            if (p.z > 1) { projected[id] = null; continue; }
            projected[id] = {
                x: (p.x * 0.5 + 0.5) * W,
                y: (-p.y * 0.5 + 0.5) * H,
                el,
            };
        }
        // Apply positions, rounded to whole pixels to kill subpixel jitter.
        // (No collision pass — it was causing the left-right glitching as
        // labels crossed proximity thresholds during autorotate.)
        for (const [id, el] of Object.entries(this.labels)) {
            const p = projected[id];
            if (!p) { el.style.display = 'none'; continue; }
            el.style.display = 'block';
            // Use translate3d for GPU compositing + pixel-rounded coords —
            // smoothest possible motion as the camera orbits.
            const px = Math.round(p.x);
            const py = Math.round(p.y);
            el.style.transform =
                `translate3d(${px}px, ${py}px, 0) translate(-50%, -100%) translateY(-12px)`;
            el.style.left = '0px';
            el.style.top  = '0px';
            const dist = this.camera.position.distanceTo(el._center);
            el.style.opacity = Math.max(0.4, Math.min(1, 1 - (dist - 2) / 8));
            const stats = el.querySelector('.sec-stats');
            if (stats) stats.textContent = this._sectorStats(id);
        }
    }

    // ===================== GRAPH VIEW (ORIGINAL) =====================

    _createGraphViewButton() {
        const btn = document.createElement('div');
        btn.id = 'graph-view-btn';
        btn.innerHTML = '<span style="font-size:11px;letter-spacing:2px;color:#00e5ff;cursor:pointer;">Graph view</span>';
        btn.style.cssText = `
            position:fixed; bottom:80px; right:20px; padding:8px 16px; z-index:10; cursor:pointer;
            background:rgba(8,12,20,0.75); backdrop-filter:blur(20px);
            border:1px solid rgba(255,255,255,0.06); border-radius:8px;
        `;
        btn.addEventListener('click', () => {
            this.graphView = !this.graphView;
            btn.querySelector('span').textContent = this.graphView ? 'Cloud view' : 'Graph view';
            this._toggleGraphView();
        });
        document.body.appendChild(btn);

        // Cognition + Quantum stats are rendered into the existing left
        // sidebar (#cognition-panel in index.html) — NOT as floating boxes.
        // The methods _createQuantumIndicator / _createCognitionMonitor
        // are kept dead-code for now in case we want them back.
    }

    _createCognitionMonitor() {
        const panel = document.createElement('div');
        panel.id = 'cognition-monitor';
        panel.style.cssText = `
            position: fixed; bottom: 165px; left: 20px;
            width: 230px;
            padding: 10px 12px 11px;
            background: rgba(8,12,20,0.82); backdrop-filter: blur(10px);
            border: 1px solid rgba(255,215,51,0.22); border-radius: 4px;
            font-family: 'JetBrains','Consolas',monospace;
            font-size: 9.5px; letter-spacing: 1.0px;
            color: #cce0ee; z-index: 10;
            opacity: 0; transition: opacity 0.5s;
            line-height: 1.45;
            box-shadow: 0 0 22px rgba(255,215,51,0.10);
        `;
        panel.innerHTML = `
            <div style="color:#ffd700;font-weight:600;letter-spacing:3px;margin-bottom:6px;">
                COGNITION
            </div>
            <div style="font-size:8.5px;color:#88aacc;margin-bottom:3px;letter-spacing:1.8px;">
                RUNTIME
            </div>
            <div style="display:flex;justify-content:space-between;font-size:9px;margin-bottom:8px;">
                <div>uptime <span class="cm-uptime" style="color:#fff;font-variant-numeric:tabular-nums;">—</span></div>
                <div><span class="cm-stage" style="color:#00e5ff;">—</span></div>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:9px;margin-bottom:8px;">
                <div>steps <span class="cm-steps" style="color:#fff;font-variant-numeric:tabular-nums;">—</span></div>
                <div><span class="cm-tier" style="color:#ffd700;font-weight:600;">—</span></div>
            </div>
            <div style="font-size:8.5px;color:#88aacc;margin-bottom:2px;letter-spacing:1.8px;">
                DOPAMINE
            </div>
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;">
                <div style="flex:1;height:6px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;">
                    <div class="cm-da-bar" style="height:100%;width:50%;background:linear-gradient(90deg,#ffaa33 0%,#ffd700 100%);transition:width 0.4s ease-out;border-radius:2px;"></div>
                </div>
                <div class="cm-da-val" style="font-variant-numeric:tabular-nums;color:#ffd700;font-size:9px;width:34px;text-align:right;">0.50</div>
            </div>
            <div style="font-size:8.5px;color:#88aacc;margin-bottom:3px;letter-spacing:1.8px;">
                RECENT REWARD
            </div>
            <div class="cm-reward-list" style="font-size:9px;color:#aabbcc;margin-bottom:8px;min-height:42px;">
                <div style="opacity:0.5;font-size:8.5px;">— no events —</div>
            </div>
            <div style="font-size:8.5px;color:#88aacc;margin-bottom:3px;letter-spacing:1.8px;">
                MEMORY
            </div>
            <div style="display:flex;justify-content:space-between;font-size:9px;">
                <div>facts <span class="cm-mem-total" style="color:#fff;font-variant-numeric:tabular-nums;">—</span></div>
                <div>distilled <span class="cm-mem-distill" style="color:#00ffaa;font-variant-numeric:tabular-nums;">—</span></div>
            </div>
            <div class="cm-spont-flash"
                 style="margin-top:6px;padding:3px 6px;border-radius:2px;font-size:8.5px;
                        text-align:center;letter-spacing:2px;color:#ff66cc;
                        background:rgba(255,102,204,0.10);
                        border:1px solid rgba(255,102,204,0.25);
                        opacity:0;transition:opacity 0.5s;">
                ✦ SPONTANEOUS THOUGHT
            </div>
        `;
        document.body.appendChild(panel);
        this._cognitionPanel = panel;

        const daBar      = panel.querySelector('.cm-da-bar');
        const daVal      = panel.querySelector('.cm-da-val');
        const rewardList = panel.querySelector('.cm-reward-list');
        const memTotal   = panel.querySelector('.cm-mem-total');
        const memDistill = panel.querySelector('.cm-mem-distill');
        const spontFlash = panel.querySelector('.cm-spont-flash');
        const uptimeEl   = panel.querySelector('.cm-uptime');
        const stageEl    = panel.querySelector('.cm-stage');
        const stepsEl    = panel.querySelector('.cm-steps');
        const tierEl     = panel.querySelector('.cm-tier');

        // Tier colors so the chip reads at a glance: cheap → expensive
        const TIER_COLORS = { fast: '#88aacc', smart: '#ffd700', max: '#ff66cc' };

        const fmtUptime = (s) => {
            const d = Math.floor(s / 86400);
            const h = Math.floor((s % 86400) / 3600);
            const m = Math.floor((s % 3600) / 60);
            if (d > 0) return `${d}d ${h}h`;
            if (h > 0) return `${h}h ${m}m`;
            return `${m}m`;
        };
        const fmtSteps = (n) => {
            if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
            if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
            return String(n);
        };

        // Track which reward event IDs we've already shown so the list
        // doesn't reshuffle every poll. Use ts as identity (microsecond-ish).
        let seenRewardTs = new Set();

        const fmtRewardLine = (e) => {
            const sign = e.strength >= 0 ? '+' : '';
            const color = e.strength >= 0 ? '#00ffaa' : '#ff6644';
            const tag = (e.source || '').slice(0, 22);
            return `<div style="display:flex;justify-content:space-between;gap:6px;line-height:1.35;">
                <span style="color:${color};font-variant-numeric:tabular-nums;width:38px;">${sign}${e.strength.toFixed(2)}</span>
                <span style="color:#88aacc;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${tag}</span>
            </div>`;
        };

        const update = async () => {
            try {
                const r = await fetch('/api/cognition/snapshot');
                if (!r.ok) return;
                const s = await r.json();
                if (!s.ok) return;

                // Runtime block
                if (s.runtime) {
                    if (typeof s.runtime.uptime_sec === 'number') {
                        uptimeEl.textContent = fmtUptime(s.runtime.uptime_sec);
                    }
                    if (typeof s.runtime.steps === 'number') {
                        stepsEl.textContent = fmtSteps(s.runtime.steps);
                    }
                    if (s.runtime.stage) {
                        stageEl.textContent = String(s.runtime.stage).toLowerCase();
                    }
                    if (s.runtime.last_tier) {
                        tierEl.textContent = s.runtime.last_tier;
                        tierEl.style.color = TIER_COLORS[s.runtime.last_tier] || '#ffd700';
                    } else {
                        tierEl.textContent = 'idle';
                        tierEl.style.color = '#557788';
                    }
                }

                // Dopamine bar
                if (typeof s.dopamine === 'number') {
                    const pct = Math.max(0, Math.min(1, s.dopamine)) * 100;
                    daBar.style.width = pct.toFixed(1) + '%';
                    daVal.textContent = s.dopamine.toFixed(2);
                }

                // Reward list (latest 3, newest at top)
                const events = (s.reward_events || []).slice().reverse().slice(0, 3);
                if (events.length === 0) {
                    rewardList.innerHTML = '<div style="opacity:0.5;font-size:8.5px;">— no events —</div>';
                } else {
                    rewardList.innerHTML = events.map(fmtRewardLine).join('');
                    // Flash the panel border briefly if there's a new event
                    for (const e of events) {
                        if (!seenRewardTs.has(e.ts)) {
                            seenRewardTs.add(e.ts);
                            panel.style.borderColor = e.strength >= 0
                                ? 'rgba(0,255,170,0.55)'
                                : 'rgba(255,102,68,0.55)';
                            setTimeout(() => {
                                panel.style.borderColor = 'rgba(255,215,51,0.22)';
                            }, 800);
                        }
                    }
                }

                // Memory counts
                if (typeof s.knowledge_total === 'number')   memTotal.textContent = s.knowledge_total;
                if (typeof s.knowledge_distilled === 'number') memDistill.textContent = s.knowledge_distilled;

                panel.style.opacity = 1;
            } catch (e) { /* retry next poll */ }
        };
        update();
        setInterval(update, 1500);

        // Listen for spontaneous-thought WS events broadcast by Phase 6.
        // The proactive loop sets `from_spontaneous: true` on its
        // brain_response_start event — flash the indicator on each.
        window.addEventListener('leon-spontaneous-thought', () => {
            spontFlash.style.opacity = 1;
            setTimeout(() => { spontFlash.style.opacity = 0; }, 4000);
        });
    }

    _createQuantumIndicator() {
        const pill = document.createElement('div');
        pill.id = 'quantum-indicator';
        pill.style.cssText = `
            position: fixed; bottom: 80px; left: 20px;
            padding: 6px 11px;
            background: rgba(8,12,20,0.78); backdrop-filter: blur(8px);
            border: 1px solid rgba(0,229,255,0.20); border-radius: 4px;
            font-family: 'JetBrains','Consolas',monospace;
            font-size: 9.5px; letter-spacing: 1.2px;
            color: #00e5ff; z-index: 10;
            cursor: default;
            opacity: 0; transition: opacity 0.5s;
            line-height: 1.4;
            min-width: 200px;
        `;
        pill.innerHTML = `
            <div style="font-weight:600;letter-spacing:3px;">QUANTUM</div>
            <div class="q-source" style="opacity:0.85;font-size:9px;margin-top:2px;">— · —</div>
            <div class="q-stats"  style="opacity:0.65;font-size:8.5px;margin-top:1px;font-variant-numeric:tabular-nums;">—</div>
        `;
        document.body.appendChild(pill);
        this._quantumPill = pill;

        // Poll /api/quantum/status every 2 seconds
        const update = async () => {
            try {
                const r = await fetch('/api/quantum/status');
                if (!r.ok) return;
                const s = await r.json();
                if (!s.enabled) {
                    pill.querySelector('.q-source').textContent = 'offline';
                    pill.querySelector('.q-stats').textContent  = s.reason || s.error || '';
                    pill.style.borderColor = 'rgba(255,80,80,0.30)';
                    pill.style.color = '#ff5544';
                    pill.style.opacity = 1;
                    return;
                }
                const isIBM = s.source && s.source.startsWith('ibm:');
                const color = isIBM ? '#00ffcc' : '#88aacc';
                pill.style.color = color;
                pill.style.borderColor = isIBM ? 'rgba(0,255,204,0.35)' : 'rgba(136,170,204,0.20)';
                pill.querySelector('.q-source').textContent =
                    isIBM ? s.source.replace('ibm:', 'IBM · ')
                          : 'classical fallback';
                const bits = s.bits_consumed || 0;
                const bufK = ((s.buffer_bits || 0) / 1024).toFixed(1);
                const totalK = (bits / 1000).toFixed(1);
                const qb = s.batches_quantum || 0;
                pill.querySelector('.q-stats').textContent =
                    `${totalK}K bits used · buf ${bufK}Kb · q-batches ${qb}`;
                pill.style.opacity = 1;
            } catch (e) {
                // Server might not be up — just retry next interval
            }
        };
        update();
        setInterval(update, 2000);
    }

    _toggleGraphView() {
        if (this.graphView) this._buildConnectionLines();
        else if (this._connectionLines) {
            this._connectionLines.forEach(l => this.scene.remove(l));
            this._connectionLines = [];
        }
    }

    _buildConnectionLines() {
        if (this._connectionLines) this._connectionLines.forEach(l => this.scene.remove(l));
        this._connectionLines = [];
        for (const [a, b] of CONNECTIONS) {
            const la = REGION_LAYOUT[a], lb = REGION_LAYOUT[b];
            if (!la || !lb) continue;
            const geo = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(la.x, la.y, la.z),
                new THREE.Vector3(lb.x, lb.y, lb.z),
            ]);
            const mat = new THREE.LineBasicMaterial({
                color: 0x224466, transparent: true, opacity: 0.3,
                blending: THREE.AdditiveBlending,
            });
            const line = new THREE.Line(geo, mat);
            this.scene.add(line);
            this._connectionLines.push(line);
        }
    }

    // ===================== STATE UPDATE (ORIGINAL pulse + jitter + signals) =====

    updateState(state) {
        if (!state) return;
        this.lastState = state;
        const regionFiring = state.region_firing || {};

        // Roll up region firing → sector firing for the label stat lines
        this.sectorFiring = {};
        for (const sId of Object.keys(SECTOR_LABELS)) {
            let s = 0, c = 0;
            for (const [r, sec] of Object.entries(SECTOR_OF_REGION)) {
                if (sec !== sId) continue;
                s += regionFiring[r] || 0;
                c++;
            }
            this.sectorFiring[sId] = c ? s / c : 0;
        }

        for (const [name, mesh] of Object.entries(this.regionMeshes)) {
            const firing = regionFiring[name] || 0;
            // Opacity + size pulse (original)
            mesh.material.opacity = 0.4 + Math.min(firing * 8, 0.6);
            mesh.material.size    = 0.012 + firing * 0.02;
            const glow = this.regionGlows[name];
            if (glow) {
                glow.material.opacity = 0.04 + Math.min(firing * 2, 0.15);
                glow.material.size    = 0.035 + firing * 0.05;
            }
        }

        // Signal arcs (original — fires on real cross-region activity)
        for (const [a, b] of CONNECTIONS) {
            const firingA = regionFiring[a] || 0;
            const firingB = regionFiring[b] || 0;
            const activity = (firingA + firingB) / 2;
            if (activity > 0.005 && Math.random() < activity * 2) {
                const colorA = REGION_COLORS[a] || 0xffffff;
                const colorB = REGION_COLORS[b] || 0xffffff;
                this._spawnSignal(a, b, firingA > firingB ? colorA : colorB);
            }
        }
    }

    // ===================== ANIMATION (ORIGINAL) =====================

    animate(dt) {
        this.time += dt;
        const regionFiring = this.lastState?.region_firing || {};

        // Sleep mode — drain the lobe colours to grey and still the firing so the
        // brain visibly "goes under". Driven by the dashboard sleep poller
        // (window.__leonAsleep). Colours lerp back the instant he wakes.
        const asleep = !!(typeof window !== 'undefined' && window.__leonAsleep);
        const grey = this._greyColor || (this._greyColor = new THREE.Color(0x99a2b6));
        this._rc = this._rc || {};

        for (const [name, mesh] of Object.entries(this.regionMeshes)) {
            const firing = asleep ? 0 : (regionFiring[name] || 0);
            const phase = this.time * 0.8 + (name.length * 0.5);
            const pulse = Math.sin(phase) * 0.1 + 0.9;
            mesh.material.opacity *= pulse;

            // Fade the lobe colour toward grey while asleep, back to its hue awake.
            const baseCol = this._rc[name] || (this._rc[name] = new THREE.Color(REGION_COLORS[name] || 0xffffff));
            mesh.material.color.lerp(asleep ? grey : baseCol, 0.06);

            // Jitter (original "thinking" motion)
            if (firing > 0.005 && this._basePositions[name]) {
                const positions = mesh.geometry.attributes.position.array;
                const base = this._basePositions[name];
                const jitter = Math.min(firing * 0.15, 0.02);
                const stride = Math.max(1, Math.floor(positions.length / (300 * 3)));
                for (let i = 0; i < positions.length; i += stride * 3) {
                    positions[i]     = base[i]     + (Math.random() - 0.5) * jitter;
                    positions[i + 1] = base[i + 1] + (Math.random() - 0.5) * jitter;
                    positions[i + 2] = base[i + 2] + (Math.random() - 0.5) * jitter;
                }
                mesh.geometry.attributes.position.needsUpdate = true;
            }

            const glow = this.regionGlows[name];
            if (glow) {
                glow.material.opacity *= (Math.sin(phase + 1) * 0.1 + 0.9);
                glow.material.color.lerp(asleep ? grey : baseCol, 0.06);
            }
        }

        this._updateSignals(dt);
        this._updateLabelPositions();
        this.controls.update();
        if (this._contextLost) return;
        this.composer.render();
    }

    _onResize() {
        const w = window.innerWidth, h = window.innerHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
        this.composer.setSize(w, h);
    }

    _onClick(event) {
        const rect = this.renderer.domElement.getBoundingClientRect();
        this.mouse.x =  ((event.clientX - rect.left) / rect.width)  * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top)  / rect.height) * 2 + 1;
        this.raycaster.setFromCamera(this.mouse, this.camera);
        const intersects = this.raycaster.intersectObjects(Object.values(this.regionMeshes));
        if (intersects.length > 0) {
            const info = intersects[0].object.userData;
            const secId = SECTOR_OF_REGION[info.regionName] || 'cpu';
            const meta  = SECTOR_LABELS[secId];
            const accent = meta.accent.toString(16).padStart(6, '0');
            window.dispatchEvent(new CustomEvent('regionClick', {
                detail: {
                    name: meta.label,
                    color: accent,
                    description: meta.desc,
                    count: info.count,
                },
            }));
        }
    }
}
