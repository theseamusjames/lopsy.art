/**
 * The edit harness's in-memory library: the files opened, and per photo its
 * versions, each with its own recipe history. Pure, so the reducer can be
 * tested without React.
 */

import type { Recipe } from '@lopsy/photos-core/library/recipe';
import type { Asset, PreviewRef, VersionId } from '@lopsy/photos-core/library/types';
import { pushStep, redoStep, startHistory, undoStep, type RecipeHistory } from './recipe-history';

export interface HarnessVersion {
  readonly id: VersionId;
  readonly name: string;
  readonly history: RecipeHistory;
  readonly thumb: PreviewRef | null;
  readonly screen: PreviewRef | null;
}

export interface HarnessPhoto {
  readonly asset: Asset;
  readonly versions: readonly HarnessVersion[];
  readonly currentVersionId: VersionId;
}

export interface HarnessState {
  readonly photos: readonly HarnessPhoto[];
  readonly currentAssetId: string | null;
}

export type HarnessAction =
  | { readonly kind: 'open'; readonly assets: readonly Asset[]; readonly recipe: Recipe }
  | { readonly kind: 'show'; readonly assetId: string }
  | { readonly kind: 'close' }
  | { readonly kind: 'step'; readonly recipe: Recipe; readonly label: string }
  | { readonly kind: 'undo' }
  | { readonly kind: 'redo' }
  | { readonly kind: 'previews'; readonly thumb: PreviewRef; readonly screen: PreviewRef }
  | { readonly kind: 'selectVersion'; readonly versionId: VersionId }
  | { readonly kind: 'createVersion'; readonly name: string; readonly recipe: Recipe }
  | { readonly kind: 'renameVersion'; readonly versionId: VersionId; readonly name: string }
  | { readonly kind: 'deleteVersion'; readonly versionId: VersionId };

export const EMPTY_HARNESS: HarnessState = { photos: [], currentAssetId: null };

export function currentPhoto(state: HarnessState): HarnessPhoto | null {
  return state.photos.find((p) => p.asset.id === state.currentAssetId) ?? null;
}

export function currentVersion(state: HarnessState): HarnessVersion | null {
  const photo = currentPhoto(state);
  return photo?.versions.find((v) => v.id === photo.currentVersionId) ?? null;
}

function updatePhoto(state: HarnessState, update: (photo: HarnessPhoto) => HarnessPhoto): HarnessState {
  return { ...state, photos: state.photos.map((p) => (p.asset.id === state.currentAssetId ? update(p) : p)) };
}

function updateVersion(state: HarnessState, update: (version: HarnessVersion) => HarnessVersion): HarnessState {
  return updatePhoto(state, (photo) => ({
    ...photo,
    versions: photo.versions.map((v) => (v.id === photo.currentVersionId ? update(v) : v)),
  }));
}

function newVersion(id: VersionId, name: string, recipe: Recipe): HarnessVersion {
  return { id, name, history: startHistory(recipe), thumb: null, screen: null };
}

export function harnessReducer(state: HarnessState, action: HarnessAction): HarnessState {
  switch (action.kind) {
    case 'open': {
      const photos = action.assets.map((asset) => ({
        asset,
        versions: [newVersion(asset.primaryVersionId, 'Original', action.recipe)],
        currentVersionId: asset.primaryVersionId,
      }));
      return { photos, currentAssetId: photos[0]?.asset.id ?? null };
    }
    case 'show':
      return state.photos.some((p) => p.asset.id === action.assetId) ? { ...state, currentAssetId: action.assetId } : state;
    case 'close':
      return EMPTY_HARNESS;
    case 'step':
      return updateVersion(state, (v) => ({ ...v, history: pushStep(v.history, action.recipe, action.label) }));
    case 'undo':
      return updateVersion(state, (v) => ({ ...v, history: undoStep(v.history) }));
    case 'redo':
      return updateVersion(state, (v) => ({ ...v, history: redoStep(v.history) }));
    case 'previews':
      return updateVersion(state, (v) => ({ ...v, thumb: action.thumb, screen: action.screen }));
    case 'selectVersion':
      return updatePhoto(state, (p) => (p.versions.some((v) => v.id === action.versionId) ? { ...p, currentVersionId: action.versionId } : p));
    case 'createVersion':
      return updatePhoto(state, (p) => {
        let n = p.versions.length + 1;
        while (p.versions.some((v) => v.id === `${p.asset.id}-v${n}`)) n++;
        const id = `${p.asset.id}-v${n}`;
        return { ...p, versions: [...p.versions, newVersion(id, action.name, action.recipe)], currentVersionId: id };
      });
    case 'renameVersion':
      return updatePhoto(state, (p) => ({
        ...p,
        versions: p.versions.map((v) => (v.id === action.versionId ? { ...v, name: action.name } : v)),
      }));
    case 'deleteVersion':
      return updatePhoto(state, (p) => {
        if (p.versions.length <= 1) return p;
        const versions = p.versions.filter((v) => v.id !== action.versionId);
        const currentVersionId = p.currentVersionId === action.versionId ? (versions[0]?.id ?? p.currentVersionId) : p.currentVersionId;
        return { ...p, versions, currentVersionId };
      });
  }
}
