import { create } from 'zustand';

/** Whether the AI sidebar is showing; once opened it stays loaded (chat and model survive closing). */
export const useAiSidebar = create<{ open: boolean; used: boolean }>(() => ({ open: false, used: false }));
export const toggleAiSidebar = () => useAiSidebar.setState((s) => ({ open: !s.open, used: true }));
