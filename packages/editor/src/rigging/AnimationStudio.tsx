import { create } from 'zustand';
import { useEffect, useRef, useState } from 'react';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  Animator,
  ModelRenderer,
  SKELETONS,
  SkeletonType,
  THREE,
  adaptClips,
  applyPose,
  autoFitSkeleton,
  bindModel,
  buildPoseClip,
  capturePose,
  clipToKeys,
  eventsCrossed,
  exportRigged,
  fitSkeleton,
  loadMoreClips,
  loadSkeletonTemplate,
  mapBones,
  measuringMesh,
  retargetByPose,
  sameBodyPlan,
  poseAt,
  reachTo,
  sampleClipPose,
  simplifyHands,
  type ClipEvent,
  type HandStyle,
  type ModelAnimationData,
  type PoseKey,
} from '@ege/runtime';
import { useEditor } from '../state/editorStore';
import { assetSummary, getAssetRecord, replaceModelFile, updateAssetData } from '../assets/library';
import { importFiles } from '../assets/importActions';
import { addComponent, editComponent } from '../editor/actions';
import { Icon } from '../ui/Icon';
import { StudioTimeline } from './StudioTimeline';

/*
 * The Animation Studio: 1. say what the thing is (human, four legs, bird…), 2. drag the points so
 * the skeleton fits it, 3. animate it: drag points on a timeline (keys are made for you) and add
 * code points that send the object a message when the animation reaches them. Existing rigged
 * models open straight at step 3.
 */

/** What to work on: an object in the scene, or a model in the Project panel. */
export interface AnimTarget {
  entityId?: string;
  assetId?: string;
}
export const useStudio = create<{ target: AnimTarget | null }>(() => ({ target: null }));
export const openAnimationStudio = (target: AnimTarget) => useStudio.setState({ target });
const close = () => useStudio.setState({ target: null });

export function AnimationStudio() {
  const target = useStudio((s) => s.target);
  if (!target) return null;
  return <StudioWindow key={target.entityId ?? target.assetId} target={target} />;
}

/** The everyday ready-made clips kept when saving a new rig (all of them makes a much bigger file). */
const BASIC = /idle|walk|jog|run|sprint|jump|fall|punch|attack|hit|death|die|swim|climb|ladder|hang|crouch|roll|interact|sit/i;

type Step = 'type' | 'fit' | 'animate';

interface MyAnimation {
  keys: PoseKey[];
  loop: boolean;
  length: number;
}

interface View {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  orbit: OrbitControls;
  /** The model as it was (shown while fitting a new skeleton). */
  model: THREE.Object3D | null;
  modelBox: THREE.Box3 | null;
  /** The skeleton's top bone. */
  root: THREE.Bone | null;
  /** What gets animated: the newly rigged model, or the model itself if it already had a skeleton. */
  rig: THREE.Object3D | null;
  joints: THREE.Mesh[];
  helper: THREE.SkeletonHelper | null;
  mixer: THREE.AnimationMixer | null;
  /** The animation playing in the preview. */
  action: THREE.AnimationAction | null;
  scale: number;
  /** The rest pose (every bone), the base for ready-made clips and new animations. */
  rest: PoseKey | null;
  /** Bones that move, not just turn (the root and hips): jumps, crouches. */
  moving: string[];
  drag: { bone: THREE.Bone; plane: THREE.Plane } | null;
  rawClips: THREE.AnimationClip[];
  /** A two-sided copy of the model, to find the middle of a body part under the mouse. */
  measure: THREE.Mesh | null;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

function StudioWindow({ target }: { target: AnimTarget }) {
  const engine = useEditor((s) => s.engine);
  const log = useEditor((s) => s.log);
  const entity = target.entityId ? engine?.world.getById(target.entityId) : undefined;
  const modelId = entity?.get(ModelRenderer)?.model || target.assetId || '';
  const title = entity?.name ?? assetSummary(modelId)?.name ?? 'Model';
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<View | null>(null);

  const [step, setStep] = useState<Step>('type');
  const [reached, setReached] = useState<Step>('type');
  const [status, setStatus] = useState('Loading the model…');
  const [busy, setBusy] = useState(false);
  const [kind, setKind] = useState<SkeletonType | null>(null);
  const [mirror, setMirror] = useState(true);
  const [hands, setHands] = useState<HandStyle>('simple');
  const [alone, setAlone] = useState(false);
  /** The rig was made in this window (saving makes a new animated model). */
  const [newRig, setNewRig] = useState(false);
  const [library, setLibrary] = useState<THREE.AnimationClip[]>([]);
  const [mine, setMine] = useState<Record<string, MyAnimation>>({});
  const [events, setEvents] = useState<Record<string, ClipEvent[]>>({});
  const [current, setCurrent] = useState('');
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<{ kind: 'key' | 'event'; index: number } | null>(null);
  const [filter, setFilter] = useState('');
  const [message, setMessage] = useState('footstep');
  const [flash, setFlash] = useState('');
  /** Ready-made animations ticked to be saved into the model. */
  const [kept, setKept] = useState<Set<string>>(new Set());

  const BASIC_ONLY = useRef(false);
  // The latest values, for the 3D view's mouse handlers and render loop.
  const live = useRef({ step, mirror, alone, current, time, playing, mine, events, onPoseEdited: () => {}, remember: () => {} });

  // ── the 3D view ────────────────────────────────────────────────────────────
  useEffect(() => {
    const el = host.current;
    if (!el || !engine || !modelId) return;
    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.setSize(el.clientWidth, el.clientHeight);
    el.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#23262d');
    scene.add(new THREE.HemisphereLight('#ffffff', '#445', 1.6));
    const sun = new THREE.DirectionalLight('#ffffff', 2);
    sun.position.set(3, 5, 4);
    scene.add(sun);
    const grid = new THREE.GridHelper(10, 20, 0x555555, 0x333333);
    scene.add(grid);
    const camera = new THREE.PerspectiveCamera(40, el.clientWidth / el.clientHeight, 0.01, 200);
    const orbit = new OrbitControls(camera, renderer.domElement);
    orbit.enableDamping = true;
    const v: View = { renderer, scene, camera, orbit, model: null, modelBox: null, root: null, rig: null, joints: [], helper: null, mixer: null, action: null, scale: 1, rest: null, moving: [], drag: null, rawClips: [], measure: null };
    view.current = v;
    const resize = new ResizeObserver(() => {
      renderer.setSize(el.clientWidth, el.clientHeight);
      camera.aspect = el.clientWidth / Math.max(1, el.clientHeight);
      camera.updateProjectionMatrix();
    });
    resize.observe(el);

    let raf = 0;
    let last = performance.now();
    let frame = 0;
    let shown = 0;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      const L = live.current;
      if (L.playing && v.mixer) {
        v.mixer.update(dt);
        const t = v.action?.time ?? 0;
        // Code points light up as the preview passes them.
        for (const ev of eventsCrossed(L.events[L.current] ?? [], shown, t)) {
          setFlash(ev.message);
          window.setTimeout(() => setFlash((f) => (f === ev.message ? '' : f)), 700);
        }
        shown = t;
        if (++frame % 3 === 0) setTime(round2(t));
      } else shown = L.time;
      orbit.update();
      const p = new THREE.Vector3();
      for (const j of v.joints) j.position.copy((j.userData.bone as THREE.Bone).getWorldPosition(p));
      renderer.render(scene, camera);
    };
    loop();

    // Drag a point: fitting moves the joint; animating bends the bones above it to follow.
    const ray = new THREE.Raycaster();
    const pointer = (ev: PointerEvent) => {
      const r = renderer.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1), camera);
    };
    /** The point nearest the mouse on screen (within a finger's width). */
    const nearestJoint = (ev: PointerEvent): THREE.Mesh | null => {
      const r = renderer.domElement.getBoundingClientRect();
      let best: THREE.Mesh | null = null;
      let bestD = 18;
      for (const j of v.joints) {
        if (!j.visible) continue;
        const s = j.position.clone().project(camera);
        const d = Math.hypot(((s.x + 1) / 2) * r.width + r.left - ev.clientX, ((1 - s.y) / 2) * r.height + r.top - ev.clientY);
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      }
      return best;
    };
    const onDown = (ev: PointerEvent) => {
      if (ev.button !== 0) return;
      pointer(ev);
      const hit = { object: nearestJoint(ev) };
      if (!hit.object) return;
      const bone = hit.object.userData.bone as THREE.Bone;
      live.current.remember();
      const at = bone.getWorldPosition(new THREE.Vector3());
      v.drag = { bone, plane: new THREE.Plane().setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()), at) };
      orbit.enabled = false;
      if (live.current.playing) {
        v.mixer?.stopAllAction();
        live.current.playing = false;
        setPlaying(false);
      }
      for (const j of v.joints) (j.material as THREE.MeshBasicMaterial).color.set(j === hit.object ? '#ffd34d' : '#4fc3f7');
      renderer.domElement.setPointerCapture(ev.pointerId);
    };
    const onMove = (ev: PointerEvent) => {
      if (!v.drag) return;
      pointer(ev);
      const p = ray.ray.intersectPlane(v.drag.plane, new THREE.Vector3());
      if (!p) return;
      const { bone } = v.drag;
      if (live.current.step === 'fit') {
        // Over the model: the middle of the body part under the mouse (between its front and back).
        if (v.measure) {
          const hits = ray.intersectObject(v.measure, false);
          if (hits.length) p.copy(hits[0].point).add(hits[hits.length > 1 ? 1 : 0].point).multiplyScalar(0.5);
        }
        const put = live.current.alone ? placeJoint : moveJoint;
        put(bone, p);
        const twin = live.current.mirror && v.root ? twinOf(bone, v.root) : null;
        if (twin && v.root) {
          const cx = v.root.getWorldPosition(new THREE.Vector3()).x;
          put(twin, new THREE.Vector3(2 * cx - p.x, p.y, p.z));
        }
      } else if (v.moving.includes(bone.name)) {
        bone.position.copy(bone.parent!.worldToLocal(p.clone()));
        bone.updateMatrixWorld(true);
      } else reachTo(bone, p, 2);
    };
    const onUp = () => {
      if (!v.drag) return;
      v.drag = null;
      orbit.enabled = true;
      if (live.current.step === 'animate') live.current.onPoseEdited();
    };
    renderer.domElement.addEventListener('pointerdown', onDown);
    renderer.domElement.addEventListener('pointermove', onMove);
    renderer.domElement.addEventListener('pointerup', onUp);

    void engine.assets.instantiate(modelId).then(({ object, animations }) => {
      if (view.current !== v) return;
      scene.add(object);
      object.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(object, true);
      v.model = object;
      v.modelBox = box;
      const size = box.getSize(new THREE.Vector3());
      const c = box.getCenter(new THREE.Vector3());
      const extent = Math.max(size.x, size.y, size.z, 1e-3);
      orbit.target.copy(c);
      camera.position.copy(c).add(new THREE.Vector3(0, size.y * 0.1, extent * 2.2));
      camera.near = extent * 0.002;
      camera.far = extent * 60;
      camera.updateProjectionMatrix();
      grid.scale.setScalar(Math.max(0.2, size.y / 2));
      grid.position.y = box.min.y;
      // Rigged = a mesh is skinned to bones (a stray bone on its own doesn't count).
      let root: THREE.Bone | null = null;
      object.traverse((o) => {
        const skinned = o as THREE.SkinnedMesh;
        if (root || !skinned.isSkinnedMesh || !skinned.skeleton?.bones.length) return;
        let b: THREE.Object3D = skinned.skeleton.bones[0];
        while ((b.parent as THREE.Bone | null)?.isBone) b = b.parent!;
        root = b as THREE.Bone;
      });
      if (!root) {
        setStatus('What is it? Pick the closest kind: its skeleton downloads and fits itself inside.');
        return;
      }
      // Already has a skeleton: straight to animating.
      const data = (getAssetRecord(modelId)?.data ?? {}) as ModelAnimationData;
      const madeHere = data.poseClips ?? {};
      startAnimating(v, object, root, animations.filter((a) => !madeHere[a.name]));
      void addFreeLibrary(v);
      setMine(Object.fromEntries(Object.entries(madeHere).map(([n, a]) => [n, { ...a, keys: a.keys.map((k) => ({ ...k })) }])));
      setEvents(data.clipEvents ?? {});
      setStep('animate');
      setReached('animate');
    });

    return () => {
      cancelAnimationFrame(raf);
      resize.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onDown);
      renderer.domElement.removeEventListener('pointermove', onMove);
      renderer.domElement.removeEventListener('pointerup', onUp);
      orbit.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      view.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the view is built once per model
  }, [engine, modelId]);

  /** Joint dots on every bone (except the tips). */
  const addJoints = (v: View, root: THREE.Bone) => {
    for (const j of v.joints) {
      j.removeFromParent();
      j.geometry.dispose();
    }
    v.joints = [];
    const box = v.modelBox ?? new THREE.Box3(new THREE.Vector3(), new THREE.Vector3(1, 1, 1));
    const r = (box.max.y - box.min.y) * 0.013;
    root.traverse((o) => {
      const b = o as THREE.Bone;
      if (!b.isBone || /leaf|tip|end$/i.test(b.name)) return;
      const j = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), new THREE.MeshBasicMaterial({ color: '#4fc3f7', depthTest: false, transparent: true, opacity: 0.9 }));
      j.renderOrder = 10;
      j.userData.bone = b;
      v.scene.add(j);
      v.joints.push(j);
    });
  };

  /** Step 3 setup: what's animated, its rest pose and its ready-made clips. */
  const startAnimating = (v: View, rig: THREE.Object3D, root: THREE.Bone, clips: THREE.AnimationClip[]) => {
    v.rig = rig;
    v.root = root;
    const firstChild = root.children.find((o) => (o as THREE.Bone).isBone);
    v.moving = [root.name, ...(firstChild ? [firstChild.name] : [])];
    v.rest = capturePose(root, 0, v.moving);
    v.mixer = new THREE.AnimationMixer(rig);
    addJoints(v, root);
    showSides(v, false);
    setLibrary(clips);
    setKept(new Set(clips.filter((c) => !BASIC_ONLY.current || BASIC.test(c.name)).map((c) => c.name)));
    setStatus('');
  };

  // ── step 1 and 2: what it is, fit the points ───────────────────────────────
  const pickKind = async (type: SkeletonType, style: HandStyle = hands) => {
    const v = view.current;
    if (!v?.modelBox || !v.model) return;
    setKind(type);
    setBusy(true);
    setStatus('Downloading the skeleton and its animations…');
    try {
      const template = await loadSkeletonTemplate(type);
      if (view.current !== v) return;
      v.root?.removeFromParent();
      v.helper?.removeFromParent();
      v.root = template.root;
      v.rawClips = template.clips;
      simplifyHands(template.root, style);
      v.scale = fitSkeleton(template.root, v.modelBox);
      setStatus('Fitting the points to the model…');
      await new Promise((r) => requestAnimationFrame(r));
      v.measure ??= measuringMesh(v.model);
      autoFitSkeleton(template.root, v.measure);
      v.scene.add(template.root);
      v.helper = new THREE.SkeletonHelper(template.root);
      v.scene.add(v.helper);
      addJoints(v, template.root);
      seeThrough(v.model, true);
      setStep('fit');
      setReached('fit');
      setStatus('The points fitted themselves. Check the elbows, knees and hands: drag any that are off. Then "Done fitting".');
      showSides(v, live.current.mirror);
      // The rest of the library arrives meanwhile (also after fitting is done).
      void loadMoreClips(type).then((more) => {
        if (view.current !== v || v.root !== template.root) return;
        v.rawClips = [...v.rawClips, ...more];
        if (!v.rig) return;
        const added = onlyBonesOf(adaptClips(more, type, v.scale), template.root);
        setLibrary((l) => [...l, ...added]);
        setKept((k) => new Set([...k, ...added.filter((c) => BASIC.test(c.name)).map((c) => c.name)]));
      });
    } catch (err) {
      setStatus(`Couldn't load that skeleton: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const refit = () => {
    const v = view.current;
    if (!v?.root || !v.measure) return;
    autoFitSkeleton(v.root, v.measure);
  };

  const doneFitting = () => {
    const v = view.current;
    if (!v?.root || !v.model || kind === null) return;
    setBusy(true);
    setStatus('Working out which point moves which part…');
    requestAnimationFrame(() => {
      try {
        seeThrough(v.model!, false);
        v.model!.visible = false;
        v.helper?.removeFromParent();
        v.helper = null;
        const rig = bindModel(v.model!, v.root!, kind);
        BASIC_ONLY.current = true; // a new rig keeps the everyday ready-made ones to start with
        v.scene.add(rig);
        startAnimating(v, rig, v.root!, onlyBonesOf(adaptClips(v.rawClips, kind, v.scale), v.root!));
        setNewRig(true);
        setStep('animate');
        setReached('animate');
      } catch (err) {
        setStatus(`That didn't work: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setBusy(false);
      }
    });
  };

  // ── step 3: animate ────────────────────────────────────────────────────────
  const libClip = (name: string) => library.find((c) => c.name === name);
  const lengthOf = (name: string) => mine[name]?.length ?? libClip(name)?.duration ?? 2;

  /** Show the selected animation's pose at time t. */
  const showPose = (name: string, t: number, list = mine) => {
    const v = view.current;
    if (!v?.root || !v.rest) return;
    v.mixer?.stopAllAction();
    const a = list[name];
    const clip = libClip(name);
    if (a) applyPose(v.root, poseAt(a.keys, t, a.loop, a.length) ?? v.rest);
    else if (clip) applyPose(v.root, sampleClipPose(clip, v.rest, Math.min(t, clip.duration)));
    else applyPose(v.root, v.rest);
  };

  const goTo = (t: number) => {
    stop();
    setTime(t);
    if (current) showPose(current, t);
  };

  const choose = (name: string) => {
    stop();
    setCurrent(name);
    setSelected(null);
    setTime(0);
    showPose(name, 0);
  };

  const uniqueName = (base: string) => {
    const taken = new Set([...Object.keys(mine), ...library.map((c) => c.name)]);
    let n = base;
    for (let i = 2; taken.has(n); i++) n = `${base} ${i}`;
    return n;
  };

  const newAnimation = () => {
    const v = view.current;
    if (!v?.rest) return;
    remember();
    const name = uniqueName('My animation');
    const next = { ...mine, [name]: { keys: [{ ...v.rest, time: 0 }], loop: true, length: 2 } };
    setMine(next);
    setCurrent(name);
    setTime(0);
    setSelected(null);
    showPose(name, 0, next);
  };

  /** A ready-made animation as your own, to change its poses. */
  const editCopy = (from: string): string | null => {
    const v = view.current;
    const clip = libClip(from);
    if (!v?.rest || !clip) return null;
    const name = uniqueName(`${from} (mine)`);
    const copy = { keys: clipToKeys(clip, v.rest, 6), loop: true, length: round2(clip.duration) };
    setMine((m) => ({ ...m, [name]: copy }));
    setEvents((e) => (e[from] ? { ...e, [name]: e[from].map((x) => ({ ...x })) } : e));
    setCurrent(name);
    return name;
  };

  /** A point was dragged: the pose at the playhead becomes a key (made for you). */
  const keyPose = () => {
    const v = view.current;
    if (!v?.root) return;
    let name = current;
    if (!mine[name]) {
      // Changing a ready-made animation: it becomes your own copy first.
      const copy = libClip(name) ? editCopy(name) : null;
      if (!copy) return;
      name = copy;
    }
    const key = capturePose(v.root, round2(time), v.moving);
    setMine((m) => {
      const a = m[name] ?? { keys: [], loop: true, length: 2 };
      const keys = [...a.keys.filter((k) => Math.abs(k.time - key.time) > 0.02), key].sort((x, y) => x.time - y.time);
      return { ...m, [name]: { ...a, keys, length: Math.max(a.length, key.time) } };
    });
  };

  const moveKey = (i: number, t: number) =>
    setMine((m) => {
      const a = m[current];
      if (!a) return m;
      const keys = a.keys.map((k, j) => (j === i ? { ...k, time: t } : k));
      return { ...m, [current]: { ...a, keys, length: Math.max(a.length, t) } };
    });

  const deleteSelected = () => {
    if (!selected) return;
    remember();
    if (selected.kind === 'key') {
      setMine((m) => {
        const a = m[current];
        return a && a.keys.length > 1 ? { ...m, [current]: { ...a, keys: a.keys.filter((_, j) => j !== selected.index) } } : m;
      });
    } else setEvents((e) => ({ ...e, [current]: (e[current] ?? []).filter((_, j) => j !== selected.index) }));
    setSelected(null);
  };

  const addCodePoint = () => {
    const msg = message.trim().replace(/[^\w]/g, '');
    if (!current || !msg) return;
    remember();
    setEvents((e) => ({ ...e, [current]: [...(e[current] ?? []), { time: round2(time), message: msg }].sort((a, b) => a.time - b.time) }));
  };

  const moveEvent = (i: number, t: number) => setEvents((e) => ({ ...e, [current]: (e[current] ?? []).map((x, j) => (j === i ? { ...x, time: t } : x)) }));
  const renameEvent = (i: number, msg: string) => remember() || setEvents((e) => ({ ...e, [current]: (e[current] ?? []).map((x, j) => (j === i ? { ...x, message: msg.replace(/[^\w]/g, '') } : x)) }));

  const setMineField = (patch: Partial<MyAnimation>) => remember() || setMine((m) => (m[current] ? { ...m, [current]: { ...m[current], ...patch } } : m));

  const renameMine = (to: string) => {
    const name = to.trim();
    if (!name || name === current || mine[name] || libClip(name)) return;
    remember();
    setMine((m) => {
      const { [current]: a, ...rest } = m;
      return a ? { ...rest, [name]: a } : m;
    });
    setEvents((e) => {
      const { [current]: list, ...rest } = e;
      return list ? { ...rest, [name]: list } : e;
    });
    setCurrent(name);
  };

  const deleteMine = () => {
    remember();
    setMine((m) => Object.fromEntries(Object.entries(m).filter(([n]) => n !== current)));
    setCurrent('');
  };

  const clipFor = (name: string): THREE.AnimationClip | undefined => {
    const a = mine[name];
    return a ? buildPoseClip(name, a.keys, a.loop, a.length) : libClip(name);
  };

  const play = () => {
    const v = view.current;
    const clip = clipFor(current);
    if (!v?.mixer || !clip) return;
    v.mixer.stopAllAction();
    v.mixer.uncacheRoot(v.rig!);
    const action = v.mixer.clipAction(clip);
    const loops = mine[current]?.loop ?? true;
    action.setLoop(loops ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    action.clampWhenFinished = true;
    action.reset().play();
    action.time = time >= clip.duration - 0.01 ? 0 : time;
    v.action = action;
    live.current.playing = true;
    setPlaying(true);
  };

  function stop() {
    if (!live.current.playing) return;
    view.current?.mixer?.stopAllAction();
    live.current.playing = false;
    setPlaying(false);
  }

  // ── undo / redo ────────────────────────────────────────────────────────────
  /** Everything an edit can change: your animations, code points, ticks, and where the points are. */
  interface Snap {
    mine: Record<string, MyAnimation>;
    events: Record<string, ClipEvent[]>;
    kept: Set<string>;
    current: string;
    bones: [THREE.Bone, THREE.Vector3, THREE.Quaternion][];
  }
  const undoStack = useRef<Snap[]>([]);
  const redoStack = useRef<Snap[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const snap = (): Snap => {
    const bones: Snap['bones'] = [];
    view.current?.root?.traverse((o) => {
      if ((o as THREE.Bone).isBone) bones.push([o as THREE.Bone, o.position.clone(), o.quaternion.clone()]);
    });
    const L = live.current;
    return { mine: L.mine, events: L.events, kept: keptRef.current, current: L.current, bones };
  };
  const keptRef = useRef(kept);
  keptRef.current = kept;
  const sync = () => {
    setUndoCount(undoStack.current.length);
    setRedoCount(redoStack.current.length);
  };
  /** Call before a change: it can be undone. (Returns false so it chains: remember() || change.) */
  function remember(): false {
    undoStack.current.push(snap());
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
    sync();
    return false;
  }
  const restore = (s: Snap) => {
    stop();
    setMine(s.mine);
    setEvents(s.events);
    setKept(s.kept);
    setCurrent(s.current);
    setSelected(null);
    for (const [b, p, q] of s.bones) {
      b.position.copy(p);
      b.quaternion.copy(q);
    }
    view.current?.root?.updateMatrixWorld(true);
  };
  function undo() {
    const s = undoStack.current.pop();
    if (!s) return;
    redoStack.current.push(snap());
    restore(s);
    sync();
  }
  function redo() {
    const s = redoStack.current.pop();
    if (!s) return;
    undoStack.current.push(snap());
    restore(s);
    sync();
  }

  /**
   * A model that already has animations (and a human-shaped skeleton): the free library too, moved
   * onto its skeleton by pose. They come in unticked: tick the ones to keep.
   */
  const addFreeLibrary = async (v: View) => {
    try {
      const template = await loadSkeletonTemplate(SkeletonType.Human);
      if (view.current !== v || !v.rig || !v.root) return;
      if (!sameBodyPlan(mapBones(template.root, v.root))) return;
      setStatus('Adding the free animation library…');
      const clips = [...template.clips, ...(await loadMoreClips(SkeletonType.Human))];
      for (let i = 0; i < clips.length; i += 6) {
        if (view.current !== v) return;
        if (!live.current.playing && v.rest) applyPose(v.root, v.rest); // measured from the rest pose
        const moved = retargetByPose(clips.slice(i, i + 6), template.root, v.rig, 20);
        setLibrary((list) => {
          const taken = new Set(list.map((c) => c.name));
          // The ones it doesn't have already (models rigged here kept some of these by name).
          return [...list, ...moved.filter((c) => !taken.has(c.name))];
        });
        await new Promise((r) => setTimeout(r, 0)); // keep the window responsive
      }
      setStatus('');
    } catch {
      setStatus('');
    }
  };

  // ── save ───────────────────────────────────────────────────────────────────
  const save = async () => {
    const v = view.current;
    if (!v?.rig || !v.root || !engine) return;
    setBusy(true);
    setStatus('Saving…');
    try {
      stop();
      if (v.rest) applyPose(v.root, v.rest);
      const made = Object.entries(mine).map(([name, a]) => buildPoseClip(name, a.keys, a.loop, a.length));
      const madeNames = new Set(made.map((c) => c.name));
      const ready = library.filter((c) => kept.has(c.name) && !madeNames.has(c.name));
      const clips = [...ready, ...made];
      const saved = new Set(clips.map((c) => c.name));
      const data: ModelAnimationData = {
        clipEvents: Object.fromEntries(Object.entries(events).filter(([n, list]) => saved.has(n) && list.length)),
        poseClips: mine,
      };
      const source = assetSummary(modelId);
      if (newRig) {
        const blob = await exportRigged(v.rig, clips);
        const name = `${source?.name ?? 'Model'} (animated)`;
        const [asset] = await importFiles([{ path: `${name.replace(/[^\w ()-]+/g, '')}.glb`, blob }], source?.credit, { compact: false });
        if (!asset) throw new Error('import failed');
        await updateAssetData(asset.id, data);
        if (entity) {
          editComponent(entity, ModelRenderer.type, { model: asset.id, animation: '' }, 'Animation Studio');
          if (!entity.has(Animator)) addComponent(entity, Animator.type);
          log('info', `${entity.name} is now animated (${clips.length} animations). It walks, runs and idles by itself.`);
        } else log('info', `Saved "${asset.name}" (${clips.length} animations) in the Project panel.`);
      } else {
        // A fresh copy in its rest pose, with every clip it had plus yours.
        const fresh = await engine.assets.instantiate(modelId);
        const blob = await exportRigged(fresh.object, clips);
        await replaceModelFile(modelId, blob, `${(source?.name ?? 'model').replace(/[^\w ()-]+/g, '')}.glb`);
        const old = (getAssetRecord(modelId)?.data ?? {}) as ModelAnimationData;
        await updateAssetData(modelId, { ...old, ...data });
        log('info', `Saved ${made.length ? `${made.length} animation(s) of yours` : 'the animations'} into ${source?.name ?? 'the model'}.`);
      }
      const points = Object.values(data.clipEvents ?? {}).flat();
      if (points.length) log('info', `Code points: react to them in a script with on: { message: { ${[...new Set(points.map((p) => p.message))].map((m) => `${m}: [ … ]`).join(', ')} } }`);
      close();
    } catch (err) {
      setStatus(`Saving failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    live.current = { step, mirror, alone, current, time, playing, mine, events, onPoseEdited: keyPose, remember };
  });
  const deleteSelectedRef = useRef(deleteSelected);
  const togglePlayRef = useRef(() => {});
  const undoRef = useRef(() => {});
  const redoRef = useRef(() => {});

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Typing in a text box: its own keys (ticks, radios and sliders don't count).
      const el = e.target instanceof HTMLElement ? e.target : null;
      if (el && (el.isContentEditable || el.matches('textarea, select, input:not([type=checkbox]):not([type=radio]):not([type=range])'))) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && (e.key === 'z' || e.key === 'Z' || e.key === 'y')) {
        e.preventDefault();
        e.stopPropagation();
        if (e.key === 'y' || e.shiftKey) redoRef.current();
        else undoRef.current();
        return;
      }
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && live.current.step === 'animate') {
        e.stopPropagation();
        deleteSelectedRef.current();
      } else if (e.key === ' ' && live.current.step === 'animate') {
        e.preventDefault();
        e.stopPropagation();
        togglePlayRef.current();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
  useEffect(() => {
    deleteSelectedRef.current = deleteSelected;
    undoRef.current = undo;
    redoRef.current = redo;
    togglePlayRef.current = () => (live.current.playing ? stop() : play());
  });

  const a = mine[current];
  const keyTimes = a ? a.keys.map((k) => k.time) : current ? null : [];
  const length = current ? Math.max(lengthOf(current), ...(a?.keys.map((k) => k.time) ?? [0])) : 2;
  const shownLib = library.filter((c) => !filter || c.name.toLowerCase().includes(filter.toLowerCase()));
  const stepLabel: Record<Step, string> = { type: '1. What is it?', fit: '2. Fit the points', animate: '3. Animate' };
  const order: Step[] = ['type', 'fit', 'animate'];
  // Back from Animate isn't possible: the skeleton is already joined to the model.
  const canGo = (s: Step) => order.indexOf(s) <= order.indexOf(reached) && (reached !== 'animate' || s === 'animate');

  return (
    <div className="store-backdrop" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="rig-dialog studio-dialog" role="dialog" aria-modal="true" aria-label="Animation Studio">
        <header className="store-header">
          <Icon name="activity" size={16} />
          <h2>Animation Studio: {title}</h2>
          <div className="studio-steps">
            {order.map((s) => (
              <button key={s} className={`small ${step === s ? 'active' : ''}`} disabled={!canGo(s) || busy} onClick={() => setStep(s)}>
                {stepLabel[s]}
              </button>
            ))}
          </div>
          <span className="studio-undo">
            <button className="icon-btn" disabled={!undoCount} onClick={undo} title="Undo (Cmd/Ctrl+Z)">
              <Icon name="undo" size={14} />
            </button>
            <button className="icon-btn" disabled={!redoCount} onClick={redo} title="Redo (Cmd/Ctrl+Shift+Z)">
              <Icon name="redo" size={14} />
            </button>
          </span>
          <button className="icon-btn store-close" onClick={close} title="Close (Esc)">
            <Icon name="x" size={16} />
          </button>
        </header>
        <div className="rig-body">
          <div className="studio-main">
            <div className="rig-view" ref={host}>
              {flash && <div className="studio-flash">Code point: {flash}</div>}
            </div>
            {step === 'animate' && current && (
              <StudioTimeline
                length={length}
                time={time}
                keys={keyTimes}
                events={events[current] ?? []}
                selected={selected}
                onTime={goTo}
                onMoveKey={moveKey}
                onDragStart={remember}
                onMoveEvent={moveEvent}
                onSelect={setSelected}
              />
            )}
          </div>
          <aside className="rig-side">
            {step === 'type' && (
              <>
                <div className="tool-title">What is it?</div>
                <div className="studio-kinds">
                  {SKELETONS.map((s) => (
                    <button key={s.type} className={`studio-kind ${kind === s.type ? 'active' : ''}`} disabled={busy || !view.current?.model} onClick={() => void pickKind(s.type)}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </>
            )}
            {step === 'fit' && (
              <>
                <div className="tool-title">Fit the points</div>
                <p className="component-desc">The points fit themselves. Drag any that are off: over the model a point drops into the middle of that body part. Drag empty space to turn the view.</p>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={mirror}
                    onChange={(e) => {
                      setMirror(e.target.checked);
                      if (view.current) showSides(view.current, e.target.checked);
                    }}
                  />
                  Left and right together (only one side's points show)
                </label>
                <label className="checkbox-row">
                  <input type="checkbox" checked={alone} onChange={(e) => setAlone(e.target.checked)} />
                  Move a point on its own (otherwise the points after it come along)
                </label>
                <div className="field">
                  <label className="field-label">Hands</label>
                  <div className="field-control">
                    <select
                      value={hands}
                      disabled={busy}
                      onChange={(e) => {
                        const style = e.target.value as HandStyle;
                        setHands(style);
                        if (kind !== null) void pickKind(kind, style);
                      }}
                    >
                      <option value="simple">Simple (fingers move with the hand)</option>
                      <option value="thumb">Thumb and one finger</option>
                      <option value="fingers">Every finger</option>
                    </select>
                  </div>
                </div>
                <div className="component-actions">
                  <button className="small" disabled={busy} onClick={refit} title="Centre every point in its body part again">
                    <Icon name="wand" size={12} />
                    Fit again
                  </button>
                  <button className="small" disabled={busy || kind === null} onClick={() => kind !== null && void pickKind(kind)}>
                    <Icon name="undo" size={12} />
                    Start over
                  </button>
                </div>
                <button className="primary" disabled={busy} onClick={doneFitting}>
                  <Icon name="check" size={12} />
                  Done fitting
                </button>
              </>
            )}
            {step === 'animate' && (
              <>
                <div className="tool-title">Your animations</div>
                <div className="rig-clips studio-mine">
                  {Object.keys(mine).map((n) => (
                    <button key={n} className={`small ${current === n ? 'active' : ''}`} onClick={() => choose(n)}>
                      {n}
                    </button>
                  ))}
                  <button className="small" onClick={newAnimation}>
                    <Icon name="plus" size={12} />
                    New animation
                  </button>
                </div>
                {current && (
                  <div className="studio-current">
                    {a ? (
                      <>
                        <div className="field">
                          <label className="field-label">Name</label>
                          <div className="field-control">
                            <input key={current} defaultValue={current} onBlur={(e) => renameMine(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()} />
                          </div>
                        </div>
                        <div className="field">
                          <label className="field-label">Length (s)</label>
                          <div className="field-control">
                            <input type="number" min={0.2} max={60} step={0.1} value={a.length} onChange={(e) => setMineField({ length: Math.max(0.2, Number(e.target.value) || 1) })} />
                          </div>
                        </div>
                        <label className="checkbox-row">
                          <input type="checkbox" checked={a.loop} onChange={(e) => setMineField({ loop: e.target.checked })} />
                          Loops (ends where it starts)
                        </label>
                      </>
                    ) : (
                      <p className="component-desc">Ready-made: {current.replace(/_/g, ' ')}. Drag a point to change it (that makes your own copy), or add code points.</p>
                    )}
                    <div className="component-actions">
                      <button className="small" onClick={() => (playing ? stop() : play())} title="Space">
                        <Icon name={playing ? 'pause' : 'play'} size={12} />
                        {playing ? 'Stop' : 'Play'}
                      </button>
                      <button
                        className="small"
                        onClick={() => {
                          remember();
                          keyPose();
                        }}
                        title="Keys are also made for you whenever you drag a point"
                      >
                        <Icon name="plus" size={12} />
                        Key pose at {time.toFixed(2)} s
                      </button>
                      {a && (
                        <button className="small" onClick={deleteMine}>
                          <Icon name="trash" size={12} />
                          Delete
                        </button>
                      )}
                    </div>
                    <div className="tool-title">Code points</div>
                    <div className="studio-code">
                      <input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="message, e.g. footstep" />
                      <button className="small" onClick={addCodePoint}>
                        <Icon name="plus" size={12} />
                        Add at {time.toFixed(2)} s
                      </button>
                    </div>
                    <p className="component-desc">
                      When the animation reaches a code point, the object gets that message. A script runs code for it: <code>on: {'{'} message: {'{'} {message || 'footstep'}: [ {'{'} play: "self" {'}'} ] {'}'} {'}'}</code>
                    </p>
                    {selected && (
                      <div className="studio-selected">
                        {selected.kind === 'event' && events[current]?.[selected.index] && (
                          <input key={`${current}-${selected.index}`} defaultValue={events[current][selected.index].message} onBlur={(e) => renameEvent(selected.index, e.target.value)} title="The message this code point sends" />
                        )}
                        <button className="small" onClick={deleteSelected} title="Delete">
                          <Icon name="trash" size={12} />
                          Delete {selected.kind === 'key' ? 'this pose' : 'this code point'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
                <div className="studio-lib-head">
                  <label className="checkbox-row" title="Tick all ready-made animations (or none)">
                    <input
                      type="checkbox"
                      checked={library.length > 0 && kept.size >= library.length}
                      ref={(el) => {
                        if (el) el.indeterminate = kept.size > 0 && kept.size < library.length;
                      }}
                      onChange={(e) => {
                        remember();
                        setKept(e.target.checked ? new Set(library.map((c) => c.name)) : new Set());
                      }}
                    />
                    <span className="tool-title">Ready-made</span>
                  </label>
                  <span className="muted">
                    {kept.size} of {library.length} kept
                  </span>
                  <button className="small" onClick={() => {
                    remember();
                    setKept(new Set(library.filter((c) => BASIC.test(c.name)).map((c) => c.name)));
                  }} title="Idle, walk, run, jump, attack, hit, death, swim, climb…">
                    Everyday ones
                  </button>
                </div>
                <input placeholder="Search…" value={filter} onChange={(e) => setFilter(e.target.value)} />
                <div className="rig-clips">
                  {shownLib.map((c) => (
                    <span key={c.name} className={`studio-clip ${kept.has(c.name) ? 'kept' : ''} ${current === c.name ? 'active' : ''}`}>
                      <input
                        type="checkbox"
                        checked={kept.has(c.name)}
                        title={kept.has(c.name) ? 'Saved into the model: untick to leave it out' : 'Tick to save it into the model'}
                        onChange={(e) =>
                          remember() ||
                          setKept((k) => {
                            const next = new Set(k);
                            if (e.target.checked) next.add(c.name);
                            else next.delete(c.name);
                            return next;
                          })
                        }
                      />
                      <button onClick={() => choose(c.name)} title="Preview">
                        {c.name.replace(/_/g, ' ')}
                      </button>
                    </span>
                  ))}
                </div>
                <p className="component-desc">Ticked ones are saved into the model{kept.size > 40 ? ' (more makes a bigger file)' : ''}. Click a name to preview it.</p>
                <button className="primary" disabled={busy} onClick={() => void save()}>
                  <Icon name="check" size={12} />
                  Save
                </button>
              </>
            )}
            {status && <p className="component-desc">{status}</p>}
          </aside>
        </div>
      </div>
    </div>
  );
}

function seeThrough(model: THREE.Object3D, on: boolean): void {
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      mat.transparent = on;
      mat.opacity = on ? 0.45 : 1;
      mat.depthWrite = !on;
    }
  });
}

/** Put a joint at a world point, leaving its children where they are. */
function placeJoint(bone: THREE.Bone, world: THREE.Vector3): void {
  const kids = bone.children.map((c) => [c, c.getWorldPosition(new THREE.Vector3())] as const);
  const parent = bone.parent!;
  parent.updateWorldMatrix(true, false);
  bone.position.copy(parent.worldToLocal(world.clone()));
  bone.updateWorldMatrix(false, false);
  for (const [c, p] of kids) {
    c.position.copy(bone.worldToLocal(p));
    c.updateWorldMatrix(false, true);
  }
}

/** The same joint on the other side (thigh_l ↔ thigh_r, Arm.L ↔ Arm.R, LeftHand ↔ RightHand). */
function twinOf(bone: THREE.Bone, root: THREE.Object3D): THREE.Bone | null {
  const n = bone.name;
  const swapped = n
    .replace(/_l$/, '_R_').replace(/_r$/, '_l').replace(/_R_$/, '_r')
    .replace(/\.L$/, '.R_').replace(/\.R$/, '.L').replace(/\.R_$/, '.R')
    .replace(/^Left/, 'Right_').replace(/^Right(?!_)/, 'Left').replace(/^Right_/, 'Right');
  if (swapped === n) return null;
  return (root.getObjectByName(swapped) as THREE.Bone | undefined) ?? null;
}

/** Move a joint and the joints after it (the whole arm follows the shoulder). */
function moveJoint(bone: THREE.Bone, world: THREE.Vector3): void {
  const parent = bone.parent!;
  parent.updateWorldMatrix(true, false);
  bone.position.copy(parent.worldToLocal(world.clone()));
  bone.updateMatrixWorld(true);
}

const RIGHT_SIDE = /(^right|^r_|_right$|_r$|\.right$|\.r$)/i;

/** With left and right together, only the left side's points show (the right ones follow). */
function showSides(v: View, mirrored: boolean): void {
  for (const j of v.joints) j.visible = !mirrored || !RIGHT_SIDE.test((j.userData.bone as THREE.Bone).name);
}

/** Ready-made clips without tracks for bones this skeleton doesn't have (e.g. simplified fingers). */
function onlyBonesOf(clips: THREE.AnimationClip[], root: THREE.Object3D): THREE.AnimationClip[] {
  const names = new Set<string>();
  root.traverse((o) => names.add(o.name));
  return clips.map((c) => new THREE.AnimationClip(c.name, c.duration, c.tracks.filter((t) => names.has(t.name.slice(0, t.name.lastIndexOf('.'))))));
}
