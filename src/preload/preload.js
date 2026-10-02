'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const on = (channel) => (fn) => {
  const handler = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};
const invoke = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);
const fire = (channel) => (...args) => ipcRenderer.send(channel, ...args);

contextBridge.exposeInMainWorld('ipod', {
  ready: fire('app:ready'),
  log: (level, ...args) => ipcRenderer.send('log', level, ...args.map((a) => (a instanceof Error ? a.stack || a.message : typeof a === 'object' ? JSON.stringify(a) : String(a)))),
  state: {
    load: invoke('state:load'),
    save: invoke('state:save'),
    exportFile: invoke('state:export'),
    importFile: invoke('state:import'),
  },
  win: {
    ignoreMouse: fire('win:ignore-mouse'),
    dragStart: fire('win:drag-start'),
    dragEnd: fire('win:drag-end'),
    resize: invoke('win:resize'),
    set: invoke('win:set'),
    minimize: fire('win:minimize'),
    hide: fire('win:hide'),
    show: fire('win:show'),
    contextMenu: fire('win:context-menu'),
    quit: fire('app:quit'),
  },
  desktop: {
    nowPlaying: fire('desktop:np'),
    prefs: fire('desktop:prefs'),
  },
  library: {
    get: invoke('lib:get'),
    scan: invoke('lib:scan'),
    openFiles: invoke('lib:open-files'),
    info: invoke('lib:info'),
    autoUpdate: invoke('lib:auto-update'),
    exportPlaylist: invoke('lib:export-playlist'),
    fillArtwork: invoke('lib:fill-artwork'),
    onProgress: on('lib:progress'),
    onFoldersChanged: on('lib:folders-changed'),
    onArtProgress: on('art:progress'),
    onArtUpdated: on('lib:art-updated'),
  },
  files: {
    pathFor: (file) => {
      try {
        return webUtils.getPathForFile(file);
      } catch {
        return null;
      }
    },
    dropped: invoke('files:dropped'),
  },
  media: {
    photos: invoke('media:photos'),
    videos: invoke('media:videos'),
    texts: invoke('media:texts'),
  },
  system: {
    info: invoke('sys:info'),
    chooseFolder: invoke('dialog:folder'),
    openExternal: fire('shell:open'),
    openLogs: fire('shell:open-logs'),
  },
  net: {
    json: invoke('net:json'),
  },
  lyrics: {
    get: invoke('lyrics:get'),
  },
  podcasts: {
    feed: invoke('podcast:feed'),
    download: invoke('podcast:download'),
    remove: invoke('podcast:remove'),
    downloads: invoke('podcast:downloads'),
    importOpml: invoke('podcast:opml-import'),
    exportOpml: invoke('podcast:opml-export'),
    onProgress: on('podcast:progress'),
  },
  radio: {
    onMeta: on('radio:meta'),
  },
  spotify: {
    status: invoke('spotify:status'),
    setClientId: invoke('spotify:set-client-id'),
    login: invoke('spotify:login'),
    logout: invoke('spotify:logout'),
    token: invoke('spotify:token'),
    setUser: invoke('spotify:user'),
    openSetup: fire('spotify:setup'),
    openApp: fire('spotify:open-app'),
    closeSetup: fire('setup:close'),
    onChange: on('spotify:changed'),
  },
  updates: {
    status: invoke('update:status'),
    check: invoke('update:check'),
    install: fire('update:install'),
    onStatus: on('update:status'),
  },
  clipboard: {
    read: invoke('clipboard:read'),
  },
  onCommand: on('app:command'),
});
