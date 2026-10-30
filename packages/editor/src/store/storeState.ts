import { create } from 'zustand';

export type StoreTab = 'models' | 'animated' | 'materials' | 'skies' | 'effects' | 'sounds' | 'music' | 'images';
export type StoreSource = 'all' | 'builtin' | 'polyhaven' | 'ambientcg' | 'objaverse' | 'smithsonian';

interface StoreUiState {
  open: boolean;
  tab: StoreTab;
  source: StoreSource;
  query: string;
  category: string;
  /** Downloads in progress: item key → progress 0..1 (or -1 if size unknown). */
  downloads: Record<string, number>;
}

export const useStoreUi = create<StoreUiState>(() => ({
  open: false,
  tab: 'models',
  source: 'all',
  query: '',
  category: '',
  downloads: {},
}));

export const openAssetStore = (tab?: StoreTab) =>
  useStoreUi.setState((s) => ({ open: true, tab: tab ?? s.tab }));
export const closeAssetStore = () => useStoreUi.setState({ open: false });
