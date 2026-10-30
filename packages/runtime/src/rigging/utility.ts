/*
 * Adapted from Mesh2Motion (https://github.com/Mesh2Motion/mesh2motion-app, commit eef2de9),
 * MIT License, by Scott Petrovic and contributors: the helpers its skinning solver uses.
 */
import { Bone, Vector3, type Object3D } from 'three';

export class Utility {
  static world_position_from_object(object: Object3D): Vector3 {
    const p = new Vector3();
    object.getWorldPosition(p);
    return p;
  }

  static direction_between_points(point_1: Vector3, point_2: Vector3): Vector3 {
    return new Vector3().subVectors(point_2, point_1).normalize();
  }

  /** Orientation-only tips at the end of a chain (finger tips, head top): childless and named leaf/tip. */
  static is_leaf_bone(bone: Bone): boolean {
    if (bone.children.length > 0) return false;
    const name = bone.name.toLowerCase();
    return name.includes('leaf') || name.includes('tip');
  }

  /** Halfway between a bone's joint and its first child's: what vertex distances are measured to. */
  static bone_midpoint_to_child(bone: Bone): Vector3 {
    const bone_position = Utility.world_position_from_object(bone);
    if (bone.children.length === 0) return bone_position.clone();
    const child = bone.children[0] as Bone;
    return new Vector3().lerpVectors(bone_position, Utility.world_position_from_object(child), 0.5);
  }

  static bone_list_from_hierarchy(bone_hierarchy: Object3D): Bone[] {
    const bones: Bone[] = [];
    bone_hierarchy?.traverse((o) => {
      if (o instanceof Bone) bones.push(o);
    });
    return bones;
  }
}
