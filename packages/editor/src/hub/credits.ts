/*
 * Credits and licences: the software the editor and exported games are built with, the services
 * the Asset Store searches, and what that means for the games people make. Checked against each
 * project's licence and terms (October 2026).
 */

export interface CreditRow {
  name: string;
  what: string;
  license: string;
  url: string;
}

/** Open-source software inside the editor (and, marked, inside every exported game). */
export const SOFTWARE: CreditRow[] = [
  { name: 'three.js', what: '3D rendering, model loaders and exporters (also in exported games)', license: 'MIT', url: 'https://threejs.org' },
  { name: 'Rapier', what: 'Physics: collisions, characters, rigid bodies (also in exported games)', license: 'Apache-2.0', url: 'https://rapier.rs' },
  { name: 'WebLLM and MLC LLM (MLC)', what: 'Runs the AI assistant in the browser on the graphics chip, with MLC\'s prebuilt model libraries (editor only)', license: 'Apache-2.0', url: 'https://github.com/mlc-ai/web-llm' },
  { name: 'Easy Game Engine Builder', what: 'The AI assistant\'s own model: Qwen3 4B fine-tuned (changed) on examples made with this engine, then converted for WebLLM (downloaded only when you ask)', license: 'Apache-2.0 (from Qwen3 4B)', url: 'https://huggingface.co/Qwen/Qwen3-4B' },
  { name: 'Florence-2 (Microsoft)', what: 'The picture reader: says in words what an attached picture shows, so the assistant can build from it (downloaded only when you attach a picture)', license: 'MIT', url: 'https://huggingface.co/microsoft/Florence-2-base-ft' },
  { name: 'Transformers.js (Hugging Face) and ONNX Runtime Web (Microsoft)', what: 'Run the picture reader in the browser (editor only)', license: 'Apache-2.0 and MIT', url: 'https://github.com/huggingface/transformers.js' },
  { name: 'Unsloth, Hugging Face Transformers, TRL and PEFT', what: 'Used to train the Builder model (not part of the editor)', license: 'Apache-2.0', url: 'https://github.com/unslothai/unsloth' },
  { name: 'Mesh2Motion', what: 'Automatic skin weights in the Animation Studio (adapted code)', license: 'MIT (Copyright 2025 Scott Petrovic)', url: 'https://github.com/Mesh2Motion/mesh2motion-app' },
  { name: 'Draco decoder (Google)', what: 'Opens compressed models, loaded only when a model needs it', license: 'Apache-2.0', url: 'https://google.github.io/draco/' },
  { name: 'React', what: 'Editor interface', license: 'MIT', url: 'https://react.dev' },
  { name: 'Zustand', what: 'Editor state', license: 'MIT', url: 'https://github.com/pmndrs/zustand' },
  { name: 'CodeMirror and Lezer', what: 'Script editor', license: 'MIT', url: 'https://codemirror.net' },
  { name: 'fflate', what: 'Zip files: project files and exports', license: 'MIT', url: 'https://github.com/101arrowz/fflate' },
  { name: 'idb', what: 'Saving projects in the browser (IndexedDB)', license: 'ISC', url: 'https://github.com/jakearchibald/idb' },
  { name: 'Lucide', what: 'Icons', license: 'ISC', url: 'https://lucide.dev' },
  { name: 'Vite and TypeScript', what: 'Building the editor', license: 'MIT / Apache-2.0', url: 'https://vite.dev' },
];

/** Where the Asset Store's free assets come from, and their terms. */
export const SOURCES: CreditRow[] = [
  { name: 'Poly Haven', what: 'Materials, skies (HDRI) and models. Free API, including commercial use; it asks apps to credit Poly Haven where its assets appear (the Asset Store does).', license: 'Assets: CC0', url: 'https://polyhaven.com' },
  { name: 'ambientCG', what: 'Materials.', license: 'Assets: CC0', url: 'https://ambientcg.com' },
  { name: 'Objaverse (Allen Institute for AI)', what: 'Index of community models from Sketchfab, files hosted on Hugging Face. The Asset Store only lists models whose own licence is CC0 or CC-BY 4.0 (no non-commercial or share-alike ones).', license: 'Dataset: ODC-By 1.0; models: CC0 / CC-BY 4.0', url: 'https://objaverse.allenai.org' },
  { name: 'Smithsonian Open Access', what: 'Museum scans.', license: 'CC0', url: 'https://3d.si.edu' },
  { name: 'Openverse (WordPress Foundation)', what: 'Sounds and music from Freesound, Jamendo, Wikimedia Commons and more. Searched only for CC0, public domain and CC-BY. Made using Openverse; not endorsed by Openverse or the WordPress Foundation.', license: 'Each file: CC0 / Public Domain / CC-BY', url: 'https://openverse.org' },
  { name: 'Wikimedia Commons', what: 'Pictures (Images tab). Only CC0, public domain and CC-BY files are shown; share-alike and non-commercial ones are left out.', license: 'Each file: CC0 / Public Domain / CC-BY', url: 'https://commons.wikimedia.org' },
  { name: 'Mesh2Motion', what: 'Skeletons and the 178-animation library of the Animation Studio, downloaded from jsDelivr.', license: 'CC0', url: 'https://github.com/Mesh2Motion/mesh2motion-app' },
];

/** What the engine takes care of. */
export const HANDLED: string[] = [
  'The Asset Store only offers licences that allow use in any game, including paid ones: CC0, public domain and CC-BY. Non-commercial (NC) and share-alike (SA) models are left out.',
  'Every asset keeps its author, licence and link (shown in the Inspector). CC-BY works are credited in each exported game\'s Credits screen by themselves, which also notes that works may have been adapted (resized, optimized, rigged), as CC-BY asks.',
  'The Asset Store credits its sources where their assets appear ("Powered by Poly Haven", Objaverse, Openverse with its "not endorsed" note, Wikimedia Commons).',
  'The open-source licences of the engine inside exported games (three.js MIT, Rapier Apache-2.0) are shipped with every export (THIRD-PARTY-NOTICES.txt) and named in the Credits screen.',
  'Mesh2Motion\'s MIT notice is kept with the code adapted from it.',
  'Nothing about you or your games is sent anywhere: projects stay in your browser (or your folder). The store only downloads what you Add.',
];

