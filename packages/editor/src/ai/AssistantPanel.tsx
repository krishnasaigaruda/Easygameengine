import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEditor } from '../state/editorStore';
import { undo } from '../editor/actions';
import { importFiles } from '../assets/importActions';
import { Icon } from '../ui/Icon';
import {
  trainedModels,
  type ModelChoice,
  checkGpu,
  deleteModel,
  hasFakeModel,
  downloadBytes,
  isDownloaded,
  isRunning,
  loadFromFolder,
  loadModel,
  modelIdFor,
  plainError,
  saveToFolder,
  stopModel,
  type GpuInfo,
  type Progress,
} from './model';
import { describeStep } from './plan';
import { LIMITS, continueAnyway, setLimit, usePacer } from './pacer';
import { describePicture, isPicture } from './pictures';
import { runAgent, type PartState, type Question } from './agent';

interface Turn {
  ask: string;
  /** What it was asked, with what the attached pictures show (the model can't see them). */
  request?: string;
  /** What it saw in each attached picture. */
  seen?: string[];
  attachments: string[];
  /** Live: what it's thinking (Think mode). */
  thinking?: string;
  thought?: string;
  writing?: number;
  /** Live: checking the scene against the request. */
  checking?: string;
  questions?: Question[];
  /** Answers picked so far (one per question). */
  answers?: string[];
  /** The answers given, shown under the request. */
  answered?: string;
  summary?: string;
  parts?: PartState[];
  finished?: boolean;
  stopped?: boolean;
  error?: string;
  startedAt: number;
  thoughtFor?: number;
}

const EXAMPLES_3D = [
  'A mountain meadow with a cabin and a dog that follows you',
  'A small obby with checkpoints and a finish',
  'A spooky forest at night with a lantern',
  'A coin hunt around a village',
];
const EXAMPLES_2D = [
  'A platform level with coins and a finish',
  'A dark cave lit by torches',
  'A top-down maze with a key and a door',
  'A level with moving platforms',
];

const remembered = (key: string, fallback: string) => {
  try {
    return localStorage.getItem(`ege-ai-${key}`) ?? fallback;
  } catch {
    return fallback;
  }
};
const remember = (key: string, value: string) => {
  try {
    localStorage.setItem(`ege-ai-${key}`, value);
  } catch {
    // not remembered
  }
};

const canPickFolder = typeof window !== 'undefined' && 'showDirectoryPicker' in window;
const pickFolder = () =>
  (
    window as unknown as { showDirectoryPicker(o?: object): Promise<FileSystemDirectoryHandle> }
  ).showDirectoryPicker({ mode: 'readwrite' });
const mb = (bytes: number) =>
  bytes >= 1e9 ? `${(bytes / 1073741824).toFixed(1)} GB` : `${Math.round(bytes / 1048576)} MB`;

/** What it really did, in words (never what it hoped to do). */
function outcome(t: Turn): string {
  const parts = t.parts ?? [];
  const done = parts.filter((p) => p.status === 'done').length;
  const partly = parts.filter((p) => p.status === 'partly').length;
  const failed = parts.filter((p) => p.status === 'failed').length;
  if (t.stopped)
    return `Stopped. ${done ? `${done} part${done > 1 ? 's' : ''} were built before that; Undo takes them back.` : 'Nothing was changed.'}`;
  if (!parts.length || done + partly === 0)
    return 'I couldn\'t build that. Try saying it another way, or one piece at a time ("add a cabin near the path").';
  if (failed || partly)
    return `Built ${done} of ${parts.length} parts${partly ? ` (${partly} only partly)` : ''}. Tell me what to fix, or Undo it all.`;
  return `Done: ${t.summary ?? 'built it'}. Ask for changes anytime.`;
}

/** The input box: grows as you type; attach, Think, send / stop. */
function Composer({
  busy,
  disabled,
  think,
  setThink,
  models,
  setModels,
  onSend,
  onStop,
  autoFocus,
  modelBytes,
}: {
  busy: boolean;
  disabled: boolean;
  think: boolean;
  setThink: (v: boolean) => void;
  /** Swap in Asset Store models for things it builds out of shapes. */
  models: boolean;
  setModels: (v: boolean) => void;
  onSend: (text: string, files: File[]) => void;
  onStop: () => void;
  autoFocus?: boolean;
  /** The model's download size (its graphics memory is a bit more). */
  modelBytes: number | null;
}) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(220, el.scrollHeight)}px`;
  }, [text]);

  const send = () => {
    if (busy || disabled || !text.trim()) return;
    onSend(text.trim(), files);
    setText('');
    setFiles([]);
  };

  return (
    <div
      className={`ai-composer ${busy ? 'busy' : ''}`}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        setFiles((f) => [...f, ...Array.from(e.dataTransfer.files)].slice(0, 6));
      }}
    >
      {files.length > 0 && (
        <div className="ai-files">
          {files.map((f, i) => (
            <span key={i} className="ai-file">
              {f.type.startsWith('image/') ? (
                <img src={URL.createObjectURL(f)} alt="" />
              ) : (
                <Icon name="paperclip" size={12} />
              )}
              <span>{f.name}</span>
              <button
                className="icon-only"
                title="Remove"
                onClick={() => setFiles((x) => x.filter((_, k) => k !== i))}
              >
                <Icon name="x" size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <textarea
        ref={area}
        rows={1}
        value={text}
        autoFocus={autoFocus}
        disabled={disabled}
        placeholder={disabled ? 'Stop the game to build' : 'Describe what to make or change…'}
        aria-label="Ask the assistant"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        onPaste={(e) => {
          const pasted = Array.from(e.clipboardData.files);
          if (pasted.length) {
            e.preventDefault();
            setFiles((f) => [...f, ...pasted].slice(0, 6));
          }
        }}
      />
      <div className="ai-composer-bar">
        <button
          className="ai-round"
          title="Attach pictures, models or sounds (they're added to the project for it to use)"
          onClick={() => picker.current?.click()}
          disabled={busy}
        >
          <Icon name="plus" size={15} />
        </button>
        <input
          ref={picker}
          type="file"
          multiple
          hidden
          accept="image/*,audio/*,.glb,.gltf,.fbx,.obj"
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            setFiles((f) => [...f, ...picked].slice(0, 6));
            e.target.value = '';
          }}
        />
        <button
          className={`ai-pill ${think ? 'on' : ''}`}
          onClick={() => setThink(!think)}
          title="Think first: slower, better with big requests"
        >
          <Icon name="brain" size={13} />
          Think
        </button>
        <button
          className={`ai-pill ${models ? 'on' : ''}`}
          onClick={() => setModels(!models)}
          title="Real 3D models: things it builds out of shapes (a dog, a cabin, a tree) get a matching model from the Asset Store. Needs the internet."
        >
          <Icon name="shapes" size={13} />
          Models
        </button>
        <span className="spacer" />
        {busy ? (
          <button className="ai-round ai-send" onClick={onStop} title="Stop">
            <Icon name="square" size={12} />
          </button>
        ) : (
          <button
            className="ai-round ai-send"
            onClick={send}
            disabled={!text.trim() || disabled}
            title="Send (Enter)"
          >
            <Icon name="arrow-up" size={15} />
          </button>
        )}
      </div>
      <Usage modelBytes={modelBytes} />
    </div>
  );
}

const CPU_WORDS = { nominal: 'calm', fair: 'busy', serious: 'very busy', critical: 'hot' } as const;

/** What the assistant takes from the computer, and how much it may. */
function Usage({ modelBytes }: { modelBytes: number | null }) {
  const p = usePacer();
  // Weights, plus its working memory (about a third more).
  const gpuMB = modelBytes ? (modelBytes * 1.3) / 1048576 + 100 : null;
  return (
    <div className="ai-usage">
      {gpuMB && (
        <span title="Graphics memory the model takes while it's running. It's freed after 5 minutes without use.">
          <Icon name="cpu" size={11} />
          {gpuMB >= 1000 ? `${(gpuMB / 1024).toFixed(1)} GB` : `${Math.round(gpuMB)} MB`}
        </span>
      )}
      {p.cpu && (
        <span
          className={`cpu-${p.cpu}`}
          title="How hard the processor is working (from the browser)"
        >
          Processor {CPU_WORDS[p.cpu]}
        </span>
      )}
      {p.fps > 0 && <span title="Editor frames per second while it works">{p.fps} fps</span>}
      <span className="spacer" />
      <label title="How much of the time it may use the graphics chip. Lower: slower, but the computer stays smooth and cooler. It lowers this by itself when the computer struggles.">
        Use up to
        <select value={p.limit} onChange={(e) => setLimit(Number(e.target.value))}>
          {LIMITS.map((l) => (
            <option key={l} value={l}>
              {l === 1 ? 'all of it' : `${l * 100}%`}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

const PAUSED = {
  hot: 'The processor is running hot. Continuing when it cools down…',
  lagging: 'The computer is lagging. Continuing when the graphics chip catches up…',
  memory: 'Memory is nearly full. Continuing when there is room…',
} as const;

/** What it says it's doing while it works (a new word every few seconds). */
const BUSY_WORDS = [
  'Cooking',
  'Engineering',
  'Vibing',
  'Tinkering',
  'Sculpting',
  'Brewing',
  'Crafting',
  'Terraforming',
  'Level designing',
  'Wiring things up',
  'Painting',
  'Dreaming it up',
  'Assembling',
  'Scheming',
  'Forging',
  'Polishing',
  'Noodling',
  'Conjuring',
  'Sketching',
  'Placing things',
  'Imagining',
  'Whittling',
  'Plotting',
  'Building',
  'Fine-tuning',
  'Hammering',
  'Pondering',
];

/** `since`: when the work began (default: when this appears). */
function Busy({ since }: { since?: number }) {
  const [start] = useState(() => since ?? Date.now());
  const pacer = usePacer();
  const [now, setNow] = useState(() => Date.now());
  const [word, setWord] = useState(() => Math.floor(Math.random() * BUSY_WORDS.length));
  useEffect(() => {
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const swap = window.setInterval(
      () =>
        setWord(
          (w) => (w + 1 + Math.floor(Math.random() * (BUSY_WORDS.length - 1))) % BUSY_WORDS.length,
        ),
      3200,
    );
    return () => {
      window.clearInterval(tick);
      window.clearInterval(swap);
    };
  }, []);
  const secs = Math.max(0, Math.round((now - start) / 1000));
  if (pacer.paused)
    return (
      <div className="ai-busy paused" role="status" aria-live="polite">
        <Icon name="pause" size={13} />
        <span>{PAUSED[pacer.paused]}</span>
        <button className="ai-ghost" onClick={continueAnyway} title="Ignore it for a minute">
          Continue anyway
        </button>
      </div>
    );
  return (
    <div className="ai-busy" role="status" aria-live="polite">
      <Icon name="sparkles" size={13} />
      <span key={word} className="ai-busy-word">
        {BUSY_WORDS[word]}…
      </span>
      <span className="muted">
        {secs < 60 ? `${secs} s` : `${Math.floor(secs / 60)} min ${secs % 60} s`}
      </span>
    </div>
  );
}

function PartRow({ p }: { p: PartState }) {
  const [open, setOpen] = useState(false);
  const icon =
    p.status === 'done'
      ? 'check'
      : p.status === 'failed'
        ? 'x'
        : p.status === 'partly'
          ? 'alert'
          : p.status === 'working'
            ? 'loader'
            : 'circle';
  return (
    <li className={`ai-part ${p.status}`}>
      <button className="ai-part-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Icon name={icon} size={12} />
        <span>{p.text}</span>
        {p.steps.length > 0 && <Icon name={open ? 'chevron-down' : 'chevron-right'} size={12} />}
      </button>
      {p.status === 'working' && <Busy />}
      {open && p.steps.length > 0 && (
        <ul className="ai-part-steps">
          {p.steps.map((s, k) => {
            const label = describeStep(s);
            const failed = p.report?.skipped.find((x) => x.startsWith(label));
            return (
              <li key={k} className={failed ? 'failed' : ''} title={failed}>
                {label}
                {failed && <span className="muted"> — {failed.slice(label.length + 2)}</span>}
                {s.do === 'script' && s.code && <pre className="ai-code">{s.code}</pre>}
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}

/** The in-browser AI assistant: builds and edits the game with you, running on this computer. */
export function AssistantPanel() {
  const dimension = useEditor((s) => s.dimension);
  const playing = useEditor((s) => s.playing);
  const [gpu, setGpu] = useState<GpuInfo | null>(null);
  // The model trained on this engine (null until the site's list is read); it needs 16-bit floats.
  const [trained, setTrained] = useState<ModelChoice[] | null>(null);
  const choices = gpu && !gpu.f16 ? [] : (trained ?? []);
  const [choiceKey, setChoiceKey] = useState(() => remembered('model', ''));
  const choice: ModelChoice | undefined = choices.find((m) => m.key === choiceKey) ?? choices[0];
  const modelId = gpu && choice ? modelIdFor(choice, gpu) : null;
  const [size, setSize] = useState<number | null>(null);
  const [downloaded, setDownloaded] = useState<boolean | null>(null);
  const [toFolder, setToFolder] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [ready, setReady] = useState(hasFakeModel);
  const [problem, setProblem] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [think, setThinkState] = useState(() => remembered('think', 'on') === 'on');
  const stop = useRef(false);
  const list = useRef<HTMLDivElement>(null);
  const setThink = (v: boolean) => {
    setThinkState(v);
    remember('think', v ? 'on' : 'off');
  };
  const [models, setModelsState] = useState(() => remembered('models', 'on') === 'on');
  const setModels = (v: boolean) => {
    setModelsState(v);
    remember('models', v ? 'on' : 'off');
  };

  useEffect(() => {
    void checkGpu().then((g) => setGpu(hasFakeModel() ? { ok: true, f16: true } : g));
    void trainedModels().then(setTrained);
  }, []);

  useEffect(() => {
    if (!modelId) return;
    let live = true;
    void downloadBytes(modelId).then((b) => live && setSize(b));
    void isDownloaded(modelId).then((d) => live && setDownloaded(d));
    return () => {
      live = false;
    };
  }, [modelId]);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight, behavior: 'smooth' });
  }, [turns]);

  const start = async () => {
    if (!modelId) return;
    setProblem(null);
    setProgress({
      fraction: 0,
      text: downloaded ? 'Starting the model…' : 'Downloading the model…',
    });
    try {
      // Ask for the folder first (the browser only allows it right after a click).
      const folder = toFolder && canPickFolder && !downloaded ? await pickFolder() : null;
      await loadModel(modelId, setProgress);
      if (folder) {
        setProgress({ fraction: 1, text: 'Saving to your folder…' });
        await saveToFolder(modelId, folder, setProgress);
      }
      setDownloaded(true);
      setReady(true);
    } catch (err) {
      setProblem(err instanceof Error ? err.message : String(err));
    } finally {
      setProgress(null);
    }
  };

  const fromFolder = async () => {
    setProblem(null);
    try {
      const dir = await pickFolder();
      setProgress({ fraction: 0, text: 'Loading from your folder…' });
      const id = await loadFromFolder(dir, setProgress);
      const found = choices.find((m) => m.f16 === id || m.f32 === id);
      if (found) {
        setChoiceKey(found.key);
        remember('model', found.key);
      }
      setDownloaded(true);
      setProgress({ fraction: 0, text: 'Starting the model…' });
      await loadModel(id, setProgress);
      setReady(true);
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError'))
        setProblem(err instanceof Error ? err.message : String(err));
    } finally {
      setProgress(null);
    }
  };

  const remove = async () => {
    if (!modelId) return;
    await deleteModel(modelId);
    setReady(false);
    setDownloaded(false);
  };

  /** Run (or continue, after answers) the request in turn `index`. */
  const go = async (index: number, ask: string, attachments: string[], answers?: string) => {
    const update = (patch: Partial<Turn> | ((t: Turn) => Partial<Turn>)) =>
      setTurns((all) =>
        all.map((x, i) =>
          i === index ? { ...x, ...(typeof patch === 'function' ? patch(x) : patch) } : x,
        ),
      );
    stop.current = false;
    setBusy(true);
    // The model needs the graphics chip: the editor draws fewer frames meanwhile (still live).
    const view = useEditor.getState().engine;
    if (view) view.maxFps = 15;
    try {
      if (modelId && !hasFakeModel() && !isRunning(modelId)) {
        update({ thinking: 'Starting the model…' });
        await loadModel(modelId, () => {});
      }
      const r = await runAgent(ask, {
        answers,
        earlier: turns
          .slice(0, index)
          .filter((t) => t.finished && !t.stopped && !t.error)
          .map((t) => t.request ?? t.ask),
        think,
        realModels: models,
        attachments,
        stopped: () => stop.current,
        emit: (e) => {
          if (e.type === 'thinking')
            update({ thinking: /^\s*[{[]/.test(e.text) ? 'Planning…' : e.text });
          else if (e.type === 'writing') update({ writing: e.chars });
          else if (e.type === 'questions')
            update({
              questions: e.questions,
              answers: e.questions.map(() => ''),
              thinking: undefined,
              writing: undefined,
            });
          else if (e.type === 'plan')
            update((t) => ({
              summary: e.summary,
              parts: e.parts.map((text) => ({ text, status: 'waiting', steps: [] })),
              thought: e.thought,
              thinking: undefined,
              writing: undefined,
              thoughtFor: e.thought
                ? Math.max(1, Math.round((Date.now() - t.startedAt) / 1000))
                : undefined,
            }));
          else if (e.type === 'part')
            update((t) => ({
              parts: (t.parts ?? []).map((p, k) => (k === e.index ? e.part : p)),
              writing: undefined,
              checking: undefined,
            }));
          else if (e.type === 'checking') update({ checking: e.text, writing: undefined });
          else if (e.type === 'more')
            update((t) => ({
              parts: [...(t.parts ?? []), ...e.parts.map((text): PartState => ({ text, status: 'waiting', steps: [] }))],
              checking: undefined,
              writing: undefined,
            }));
        },
      });
      if (r.result !== 'asked')
        update({
          finished: true,
          stopped: r.result === 'stopped',
          checking: undefined,
          thinking: undefined,
          writing: undefined,
        });
    } catch (err) {
      update({
        error: plainError(err),
        thinking: undefined,
        writing: undefined,
        checking: undefined,
        finished: true,
      });
    } finally {
      if (view) view.maxFps = 0;
      setBusy(false);
    }
  };

  const send = async (ask: string, files: File[]) => {
    if (busy) return;
    if (useEditor.getState().playing) return;
    const index = turns.length;
    let attachments: string[] = [];
    if (files.length) {
      const records = await importFiles(files.map((f) => ({ path: f.name, blob: f })));
      attachments = records.map((r) => `${r.name} (${r.type})`);
    }
    setTurns((t) => [...t, { ask, attachments: files.map((f) => f.name), startedAt: Date.now() }]);
    // The model only reads text: put the pictures into words first.
    const pictures = files.filter(isPicture);
    let request = ask;
    if (pictures.length) {
      setBusy(true);
      const set = (patch: Partial<Turn>) => setTurns((all) => all.map((x, i) => (i === index ? { ...x, ...patch } : x)));
      const seen: string[] = [];
      try {
        for (const [k, f] of pictures.entries()) {
          set({ thinking: `Looking at ${pictures.length > 1 ? `picture ${k + 1}` : 'the picture'}…` });
          const text = await describePicture(f, (p) => set({ thinking: `Getting the picture reader (once)… ${Math.round(p * 100)}%` }));
          if (text) seen.push(text);
        }
      } catch (err) {
        set({ thinking: undefined, error: `Couldn't read the picture: ${err instanceof Error ? err.message : String(err)}. Describe it in words instead.`, finished: true });
        setBusy(false);
        return;
      }
      setBusy(false);
      set({ thinking: undefined, seen });
      if (seen.length) request = `${ask}\n${seen.map((t, k) => `The attached picture${seen.length > 1 ? ` ${k + 1}` : ''} shows: ${t}`).join('\n')}\nBuild it to look like the picture.`;
      set({ request });
    }
    await go(index, request, attachments);
  };

  const answer = (index: number, q: number, value: string) => {
    const t = turns[index];
    const answers = [...(t.answers ?? [])];
    answers[q] = value;
    setTurns((all) => all.map((x, i) => (i === index ? { ...x, answers } : x)));
    // All answered: carry on building.
    if (t.questions && answers.every((a) => a.trim())) {
      const text = t.questions.map((qq, k) => `${qq.q} ${answers[k]}`).join('; ');
      setTurns((all) =>
        all.map((x, i) =>
          i === index
            ? { ...x, questions: undefined, answered: answers.join(' · '), summary: undefined }
            : x,
        ),
      );
      void go(index, t.request ?? t.ask, [], text);
    }
  };

  // ── not ready yet ──
  if (!gpu) return <p className="muted ai-note">Checking this computer…</p>;
  if (!gpu.ok)
    return (
      <div className="ai-setup">
        <Icon name="alert" size={16} />
        <p>
          The assistant can't run in this browser. {gpu.reason}
          <br />
          Everything else in the editor works as normal.
        </p>
      </div>
    );
  if (!ready && !choice)
    return trained === null && gpu.f16 ? (
      <p className="muted ai-note">Checking this computer…</p>
    ) : (
      <div className="ai-setup">
        <Icon name="alert" size={16} />
        <p>
          {gpu.f16
            ? "This copy of the editor doesn't include the assistant's model."
            : "The assistant's model needs a graphics chip that does 16-bit math (most do; this one doesn't offer it to the browser)."}
          <br />
          Everything else in the editor works as normal.
        </p>
      </div>
    );
  if (!ready && choice)
    return (
      <div className="ai-setup">
        <div className="ai-hero">
          <span className="ai-orb">
            <Icon name="sparkles" size={20} />
          </span>
          <h3>Build with AI</h3>
          <p className="muted">
            Describe a scene or a game and it builds it in the editor, step by step, where you can
            see and undo everything. It runs on this computer: what you type never leaves it.
          </p>
        </div>
        <div className="ai-models">
          {choices.map((m) => (
            <label key={m.key} className={`ai-model ${m.key === choice.key ? 'active' : ''}`}>
              <input
                type="radio"
                name="ai-model"
                checked={m.key === choice.key}
                onChange={() => {
                  setChoiceKey(m.key);
                  remember('model', m.key);
                  setSize(null);
                  setDownloaded(null);
                }}
              />
              <span className="ai-model-text">
                <b>{m.label}</b>
                <span className="muted">{m.note}</span>
              </span>
              <span className="ai-size">
                {m.key === choice.key && size ? mb(size) : `~${mb(m.approxMB * 1048576)}`}
              </span>
            </label>
          ))}
        </div>
        {!downloaded && (
          <div className="ai-where">
            <span className="muted">Keep it</span>
            <label>
              <input type="radio" checked={!toFolder} onChange={() => setToFolder(false)} /> In this
              browser
            </label>
            <label
              className={canPickFolder ? '' : 'disabled'}
              title={
                canPickFolder
                  ? 'Also saved in a folder you pick: use it again without downloading (Load from a folder)'
                  : 'Needs Chrome or Edge'
              }
            >
              <input
                type="radio"
                checked={toFolder}
                disabled={!canPickFolder}
                onChange={() => setToFolder(true)}
              />{' '}
              Also in a folder
            </label>
          </div>
        )}
        {progress ? (
          <div className="ai-progress">
            <div className="ai-bar">
              <i style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
            </div>
            <span className="muted">{progress.text}</span>
          </div>
        ) : (
          <div className="ai-actions">
            <button
              className="primary ai-big"
              onClick={() => void start()}
              disabled={downloaded === null && size === null}
            >
              <Icon name={downloaded ? 'play' : 'download'} size={14} />
              {downloaded ? 'Start' : `Download${size ? ` · ${mb(size)}` : ''}`}
            </button>
            {canPickFolder && !downloaded && (
              <button
                onClick={() => void fromFolder()}
                title="Use a model you saved before (no download)"
              >
                <Icon name="folder" size={13} />
                Load from a folder
              </button>
            )}
            {downloaded && (
              <button
                className="small"
                onClick={() => void remove()}
                title="Free the space it takes in this browser"
              >
                <Icon name="trash" size={12} />
                Remove
              </button>
            )}
          </div>
        )}
        {problem && <p className="ai-problem">{problem}</p>}
      </div>
    );

  const examples = dimension === '2d' ? EXAMPLES_2D : EXAMPLES_3D;
  const composer = (centered: boolean) => (
    <Composer
      busy={busy}
      disabled={playing}
      think={think}
      setThink={setThink}
      models={models}
      setModels={setModels}
      autoFocus={centered}
      modelBytes={size}
      onSend={(t, f) => void send(t, f)}
      onStop={() => {
        stop.current = true;
        stopModel();
      }}
    />
  );

  // ── first screen: greeting with the box in the middle ──
  if (turns.length === 0)
    return (
      <div className="ai-empty">
        <span className="ai-orb">
          <Icon name="sparkles" size={20} />
        </span>
        <h3>What should we make?</h3>
        <p className="muted">Any scene or game. I'll ask if I need to know more.</p>
        {composer(true)}
        <div className="ai-examples">
          {examples.map((x) => (
            <button
              key={x}
              className="ai-chip"
              onClick={() => void send(x, [])}
              disabled={busy || playing}
            >
              {x}
            </button>
          ))}
        </div>
      </div>
    );

  // ── the conversation ──
  return (
    <div className="ai-chat">
      <div className="ai-turns" ref={list}>
        {turns.map((t, i) => (
          <div key={i} className="ai-turn">
            <div className="ai-ask">
              {t.ask}
              {t.answered && <div className="ai-ask-files">{t.answered}</div>}
              {t.seen?.map((x, k) => (
                <div key={k} className="ai-ask-seen" title="What the picture reader saw (the builder reads this)">
                  <Icon name="eye" size={10} /> {x}
                </div>
              ))}
              {t.attachments.length > 0 && (
                <div className="ai-ask-files">
                  {t.attachments.map((a) => (
                    <span key={a}>
                      <Icon name="paperclip" size={10} /> {a}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="ai-answer">
              {(t.thought || t.thinking) && (
                <details className="ai-thought" open={!!t.thinking && !t.thought}>
                  <summary>
                    <Icon name="brain" size={12} />
                    {t.thinking && !t.thought ? 'Thinking…' : `Thought for ${t.thoughtFor ?? 1} s`}
                  </summary>
                  <p>{t.thought ?? t.thinking}</p>
                </details>
              )}

              {t.questions && (
                <div className="ai-questions">
                  <p>A few questions first:</p>
                  {t.questions.map((q, k) => (
                    <div key={k} className="ai-question">
                      <b>{q.q}</b>
                      <div className="ai-options">
                        {q.options.map((o) => (
                          <button
                            key={o}
                            className={`ai-chip ${t.answers?.[k] === o ? 'on' : ''}`}
                            onClick={() => answer(i, k, o)}
                            disabled={busy}
                          >
                            {o}
                          </button>
                        ))}
                        <input
                          className="ai-own"
                          placeholder="Or type…"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && e.currentTarget.value.trim())
                              answer(i, k, e.currentTarget.value.trim());
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {t.summary && t.parts && (
                <p className="ai-summary">{t.finished ? outcome(t) : t.summary}</p>
              )}
              {t.parts && t.parts.length > 0 && (
                <ol className="ai-parts">
                  {t.parts.map((p, k) => (
                    <PartRow key={k} p={p} />
                  ))}
                </ol>
              )}
              {t.error && <p className="ai-problem">{t.error}</p>}
              {t.checking && !t.finished && (
                <p className="ai-checking">
                  <Icon name="list-checks" size={12} />
                  {t.checking}
                </p>
              )}
              {busy &&
                i === turns.length - 1 &&
                !t.finished &&
                !(t.questions && !t.answered) &&
                !t.parts?.some((p) => p.status === 'working') && <Busy since={t.startedAt} />}
              {t.finished &&
                !t.stopped &&
                (t.parts ?? []).some((p) => p.status !== 'failed') &&
                i === turns.length - 1 &&
                !busy && (
                  <button
                    className="ai-ghost"
                    onClick={undo}
                    title="Undo everything this request did"
                  >
                    <Icon name="undo" size={12} />
                    Undo
                  </button>
                )}
            </div>
          </div>
        ))}
      </div>
      <div className="ai-dock">{composer(false)}</div>
    </div>
  );
}
