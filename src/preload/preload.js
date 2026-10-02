'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (fn) => {
  const handler = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
};

contextBridge.exposeInMainWorld('ipod', {
  state: {
    load: () => ipcRenderer.invoke('state:load'),
    save: (data) => ipcRenderer.invoke('state:save', data),
  },
  win: {
    ignoreMouse: (ignore) => ipcRenderer.send('win:ignore-mouse', ignore),
    dragStart: () => ipcRenderer.send('win:drag-start'),
    dragEnd: () => ipcRenderer.send('win:drag-end'),
    resize: (size) => ipcRenderer.invoke('win:resize', size),
    set: (prefs) => ipcRenderer.invoke('win:set', prefs),
    minimize: () => ipcRenderer.send('win:minimize'),
    hide: () => ipcRenderer.send('win:hide'),
    show: () => ipcRenderer.send('win:show'),
    contextMenu: () => ipcRenderer.send('win:context-menu'),
    quit: () => ipcRenderer.send('app:quit'),
    onPrefs: on('win:prefs'),
  },
  library: {
    get: () => ipcRenderer.invoke('lib:get'),
    scan: (folders) => ipcRenderer.invoke('lib:scan', folders),
    onProgress: on('lib:progress'),
  },
  media: {
    photos: (folder) => ipcRenderer.invoke('media:photos', folder),
    videos: (folder) => ipcRenderer.invoke('media:videos', folder),
    notes: (folder) => ipcRenderer.invoke('media:notes', folder),
  },
  system: {
    info: (folder) => ipcRenderer.invoke('sys:info', folder),
    chooseFolder: (title) => ipcRenderer.invoke('dialog:folder', title),
    openExternal: (url) => ipcRenderer.send('shell:open', url),
  },
  spotify: {
    status: () => ipcRenderer.invoke('spotify:status'),
    setClientId: (id) => ipcRenderer.invoke('spotify:set-client-id', id),
    login: () => ipcRenderer.invoke('spotify:login'),
    logout: () => ipcRenderer.invoke('spotify:logout'),
    token: (opts) => ipcRenderer.invoke('spotify:token', opts),
    setUser: (user) => ipcRenderer.invoke('spotify:user', user),
    openSetup: () => ipcRenderer.send('spotify:setup'),
    openApp: () => ipcRenderer.send('spotify:open-app'),
    closeSetup: () => ipcRenderer.send('setup:close'),
    onChange: on('spotify:changed'),
  },
  onCommand: on('app:command'),
});
