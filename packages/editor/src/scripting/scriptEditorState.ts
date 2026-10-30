import { create } from 'zustand';

interface ScriptEditorState {
  /** Script asset being edited (null = closed). */
  openId: string | null;
  mode: 'visual' | 'code';
}

export const useScriptEditor = create<ScriptEditorState>(() => ({ openId: null, mode: 'visual' }));

export const openScriptEditor = (id: string) => useScriptEditor.setState({ openId: id });
export const closeScriptEditor = () => useScriptEditor.setState({ openId: null });
