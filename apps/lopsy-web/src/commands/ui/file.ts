import { defineCommand } from '../registry';
import {
  exportCanvas,
  exportPsdFile,
  openFileFromDisk,
  openProjectFromDisk,
  saveProjectFromMenu,
  startNewDocument,
} from '../../app/MenuBar/menus/file-menu';

const UNSAVED_CONFIRM = 'With unsaved changes it first asks, in a browser confirm, whether to continue.';

export const uiFileNew = defineCommand({
  id: 'ui.file.new',
  summary: `Opens the New Document dialog, as File > New does. ${UNSAVED_CONFIRM} Use doc.new to create a document directly. Returns nothing.`,
  surface: 'ui',
  settles: false,
  params: {},
  run(): void {
    startNewDocument();
  },
});

export const uiFileOpen = defineCommand({
  id: 'ui.file.open',
  summary: `Opens the browser's file picker for an image, PSD, raw or .lopsy file and opens the file chosen, as File > Open... does. ${UNSAVED_CONFIRM} It needs a user gesture; use doc.open to open bytes directly. Returns nothing.`,
  surface: 'ui',
  settles: false,
  params: {},
  run(): void {
    openFileFromDisk();
  },
});

export const uiFileOpenProject = defineCommand({
  id: 'ui.file.open-project',
  summary: `Opens the browser's file picker for a .lopsy project and loads the one chosen, as File > Open Project... does. ${UNSAVED_CONFIRM} It needs a user gesture. Returns nothing.`,
  surface: 'ui',
  settles: false,
  params: {},
  run(): void {
    openProjectFromDisk();
  },
});

export const uiFileSaveProject = defineCommand({
  id: 'ui.file.save-project',
  summary: 'Downloads the document as a .lopsy project and marks it saved, as File > Save Project does; a failure is shown as a toast. Use doc.save to get the bytes instead. Returns nothing, before the download.',
  surface: 'ui',
  settles: false,
  params: {},
  run(): void {
    saveProjectFromMenu();
  },
});

export const uiFileQuickExportPng = defineCommand({
  id: 'ui.file.quick-export-png',
  summary: 'Downloads the composite as a PNG and marks the document saved, as File > Quick Export PNG does; a failure is shown as a toast. Use doc.export to get the bytes instead. Returns nothing, before the download.',
  surface: 'ui',
  settles: false,
  params: {},
  run(): void {
    exportCanvas('png');
  },
});

export const uiFileExportPsd = defineCommand({
  id: 'ui.file.export-psd',
  summary: 'Downloads the document as a 16-bit PSD and marks it saved, as File > Export PSD does. Use doc.export-psd to get the bytes instead. Returns nothing, before the download.',
  surface: 'ui',
  settles: false,
  params: {},
  run(): void {
    void exportPsdFile(16);
  },
});
