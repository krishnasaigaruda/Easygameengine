// Core
export { Engine, QUALITY, QUALITY_LEVELS, type EngineProfile } from './core/Engine';
export type { QualityLevel } from './core/Engine';
export type { EngineOptions } from './core/Engine';
export { Time } from './core/Time';
export { World } from './core/World';
export type { System, WorldEvents, CreateEntityOptions } from './core/World';
export { Entity } from './core/Entity';
export { EventBus } from './core/EventBus';
export { newId } from './core/ids';
export {
  defineComponent,
  getComponentDef,
  allComponentDefs,
  createComponentData,
  COMPONENT_CATEGORIES,
} from './core/Component';
export type { ComponentDef, ComponentCategory, FieldSpec, Vec2, Vec3 } from './core/Component';

// Built-in components
export * from './components/builtin';
export * from './components/physics';
export * from './components/camera';
export { CameraSystem } from './render/CameraSystem';

// Scripting (EasyScript)
export * from './components/scripting';
export { ScriptSystem, EntityRef } from './easyscript/ScriptSystem';
export type { ScriptLog, ScriptEvents, ScriptHost } from './easyscript/ScriptSystem';
export { compileScript, emptyScript } from './easyscript/compile';
export type { CompiledScript, Diagnostic, Action as ScriptAction } from './easyscript/compile';
export { parseJson5, stringifyJson5, Json5Error } from './easyscript/json5';
export { parseExpr, evaluate, ExprError } from './easyscript/expr';
export * from './easyscript/spec';
export { browserSaves, memorySaves, type SaveData, type SaveStore } from './easyscript/saveGame';
export { TRAITS, TRAIT_BY_NAME, READY_TRAITS, COMING_SOON_TRAITS } from './easyscript/traits';
export type { TraitDef } from './easyscript/traits';
export { Hud, HUD_SLOTS } from './ui/Hud';
export { UISystem, UI_DESIGN_SIZE } from './ui/UISystem';
export * from './components/ui';
export * from './components/audio';
export * from './components/sprite';
export * from './components/tilemap';
export * from './components/light2d';
export { TilemapSystem } from './render/TilemapSystem';
export { SpriteSystem } from './render/SpriteSystem';
export * from './components/effects';
export * from './components/environment';
export * from './components/terrain';
export * from './components/foliage';
export * from './components/weapon';
export * from './components/keyframes';
export { WeaponSystem } from './render/WeaponSystem';
export { GrassSystem } from './render/GrassSystem';
export { ScatterSystem } from './render/ScatterSystem';
export * from './terrain/scatter';
export * from './terrain/heightmap';
export { TerrainSystem } from './render/TerrainSystem';
export { EnvironmentSystem, horizonColor } from './render/EnvironmentSystem';
export { EffectsSystem } from './render/EffectsSystem';
export { AudioSystem } from './audio/AudioSystem';

// Running games outside the editor
export { startGame } from './player/startGame';
export type { StartGameOptions } from './player/startGame';
export { showSplash, addBadge, addCredits, showCredits, showLoading, type GameCredit } from './player/Branding';
export { InstancingSystem } from './render/InstancingSystem';
export { addTouchControls, isTouchScreen } from './player/TouchControls';
export { playExportedGame, exportedFilePath, GAME_FILE, EMBEDDED_GAME_ID, EMBEDDED_FILE_TYPE, type ExportedGame, type ExportedAsset } from './player/exported';
export type { HudSlot } from './ui/Hud';

// Physics
export { PhysicsSystem } from './physics/PhysicsSystem';
export type { PhysicsEvents, PhysicsOptions } from './physics/PhysicsSystem';
export { worldMatrixOf, localMatrix, parentWorldMatrixOf, worldPoseToLocal } from './core/transformMath';

// Rendering
export { RenderSystem } from './render/RenderSystem';
export { ModelSystem, autoClip, ROLE_WORDS, type AnimatorRole } from './render/ModelSystem';
export { setFlat, isFlat } from './render/flatCamera';
export { optimizedGlb, shareRepeatedShapes, geometryKey, type OptimizeReport } from './assets/optimizeModel';
export { applyClipEvents, clipEventsOf, eventsCrossed, type ClipEvent, type ModelAnimationData } from './render/clipEvents';
export { KeyframeSystem, sampleKeyframes, keyframeTime } from './render/KeyframeSystem';
export { loadSkeletonTemplate, loadMoreClips, fitSkeleton, bindModel, adaptClips, exportRigged, bonesBox, scaleSkeleton } from './rigging/autoRig';
export type { SkeletonTemplate } from './rigging/autoRig';
export { SKELETONS, SkeletonType, skeletonInfo } from './rigging/skeletons';
export { autoFitSkeleton, measuringMesh, middleAround, simplifyHands, type HandStyle } from './rigging/autoFit';
export { mapBones, retargetByPose, sameBodyPlan } from './rigging/retarget';
export { capturePose, applyPose, buildPoseClip, poseAt, sampleClipPose, clipToKeys, reachTo } from './rigging/poses';
export type { PoseKey } from './rigging/poses';

// Assets
export { AssetManager, findFileUrl } from './assets/AssetManager';
export { findModelParts, partBounds, extractPart, partNode, type ModelPart } from './assets/modelParts';
export type { LoadedModel, AssetEvents } from './assets/AssetManager';
export * from './assets/types';
export { buildMaterial, shaderTime, BUILTIN_MATERIALS } from './render/shaders';

// Input
export { Input, defaultBindings } from './input/Input';
export type { InputBindings, AxisBinding } from './input/Input';

// Scenes
export * from './scene/SceneData';
export {
  serializeWorld,
  serializeEntity,
  instantiateEntity,
  parseScene,
  loadSceneInto,
  SceneFormatError,
} from './scene/serialize';

// Third-party engines, re-exported so the editor/games share one instance.
export { default as RAPIER } from '@dimforge/rapier3d-compat';
export * as THREE from 'three';
export { loadPhysics } from './core/loadPhysics';
