import { useTileBrush } from './tileBrush';
import { createWater, editSceneSettings } from './assetActions';
import { Camera, FollowCamera } from '@ege/runtime';
import { CREATE_PRESETS, addComponent, createObject, editComponent, type CreatePreset } from './actions';
import { useEditor } from '../state/editorStore';
import type { MenuEntry, MenuItem } from '../ui/Menu';
import { READY_MENUS, createReadyMenu, type ReadyMenu } from './readyMenus';

const item = (preset: CreatePreset, parentId: string | null): MenuItem => ({
  label: CREATE_PRESETS[preset].label,
  icon: CREATE_PRESETS[preset].icon,
  onSelect: () => createObject(preset, parentId),
});

/** A 2D player, and the main camera follows it from the side. */
function create2DPlayer(parentId: string | null, preset: 'player2d' | 'playerTopDown' = 'player2d'): void {
  const id = createObject(preset, parentId);
  const engine = useEditor.getState().engine;
  const player = id ? engine?.world.getById(id) : undefined;
  if (!engine || !player) return;
  const cam = [...engine.world.query(Camera)].find((c) => (c.get(Camera) as { primary?: boolean }).primary);
  if (!cam) return;
  addComponent(cam, FollowCamera.type);
  // Empty target = whoever is the player (still right after renaming it).
  editComponent(cam, FollowCamera.type, { mode: 'side-view', target: '', pitch: 0, distance: 20, height: 1, lockMouse: false, avoidWalls: false });
}

/** The "Create" menu, shared by the Hierarchy + button, right-click and toolbar. */
export function createMenuItems(parentId: string | null = null): MenuEntry[] {
  if (useEditor.getState().dimension === '2d') {
    return [
      item('empty', parentId),
      {
        label: '2D', icon: 'square',
        children: [
          item('sprite', parentId),
          item('background2d', parentId),
          {
            label: 'Light',
            icon: 'lightbulb',
            onSelect: () => {
              createObject('light2d', parentId);
              // A light only shows where it's dark: the first one darkens the scene a little.
              const engine = useEditor.getState().engine;
              if (engine && !engine.settings.darkness2D) {
                editSceneSettings({ darkness2D: 0.6 }, 'Darker for lights');
                useEditor.getState().log('info', 'The scene got darker so the light shows. Change it in Scene Settings: Darkness (2D lights).');
              }
            },
          },
          item('circle2d', parentId),
          item('platform2d', parentId),
          {
            label: 'Tilemap',
            icon: 'grid',
            onSelect: () => {
              // Placed at the origin (cells count from there), ready to paint.
              const id = createObject('tilemap', parentId);
              const e = id ? useEditor.getState().engine?.world.getById(id) : undefined;
              if (e) e.set('Transform', { position: [0, 0, 0] });
              useTileBrush.setState({ active: true, erase: false });
            },
          },
          { label: CREATE_PRESETS.player2d.label, icon: CREATE_PRESETS.player2d.icon, onSelect: () => create2DPlayer(parentId) },
          { label: CREATE_PRESETS.playerTopDown.label, icon: CREATE_PRESETS.playerTopDown.icon, onSelect: () => create2DPlayer(parentId, 'playerTopDown') },
        ],
      },
      item('camera', parentId),
      { label: 'UI', icon: 'layers', children: (['uiText', 'uiButton', 'uiPanel', 'uiImage', 'uiBar', 'uiRing'] as const).map((p) => item(p, parentId)) },
      {
        label: 'Menus (ready-made)', icon: 'flag',
        children: (Object.keys(READY_MENUS) as ReadyMenu[]).map((k) => ({ label: READY_MENUS[k].label, icon: READY_MENUS[k].icon, onSelect: () => void createReadyMenu(k) })),
      },
      { label: 'Environment (optional)', icon: 'mountain', children: (['sky', 'postProcessing'] as const).map((p) => item(p, parentId)) },
    ];
  }
  return [
    item('empty', parentId),
    {
      label: '3D Shapes', icon: 'box',
      children: (['cube', 'sphere', 'plane', 'cylinder', 'capsule', 'cone', 'torus'] as const).map((p) =>
        item(p, parentId),
      ),
    },
    { label: 'Lights', icon: 'sun', children: (['sun', 'pointLight', 'spotLight'] as const).map((p) => item(p, parentId)) },
    item('camera', parentId),
    {
      label: 'Environment (optional)', icon: 'mountain',
      children: [
        ...(['terrain', 'scatter'] as const).map((p) => item(p, parentId)),
        { label: 'Water', icon: 'droplets', onSelect: () => void createWater() },
        ...(['sky', 'fog', 'dayNight', 'postProcessing'] as const).map((p) => item(p, parentId)),
      ],
    },
    {
      label: 'UI', icon: 'layers',
      children: (['uiText', 'uiButton', 'uiPanel', 'uiImage', 'uiBar', 'uiRing'] as const).map((p) => item(p, parentId)),
    },
    {
      label: 'Menus (ready-made)', icon: 'flag',
      children: (Object.keys(READY_MENUS) as ReadyMenu[]).map((k) => ({ label: READY_MENUS[k].label, icon: READY_MENUS[k].icon, onSelect: () => void createReadyMenu(k) })),
    },
  ];
}
