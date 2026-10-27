'use strict';
const {contextBridge,ipcRenderer} = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  open:() => ipcRenderer.invoke('open'),
  save:payload => ipcRenderer.invoke('save',payload),
  confirmDirty:() => ipcRenderer.invoke('confirm-dirty'),
  state:state => ipcRenderer.send('state',state),
  newDocument:() => ipcRenderer.send('new-document'),
  close:() => ipcRenderer.send('close-now'),
  message:text => ipcRenderer.invoke('message',text),
  currentFont:() => ipcRenderer.invoke('font-current'),
  chooseFont:() => ipcRenderer.invoke('font-choose'),
  commitFont:token => ipcRenderer.invoke('font-commit',token),
  resetFont:() => ipcRenderer.invoke('font-reset'),
  pcgFont:payload => ipcRenderer.invoke('pcg-font',payload),
  onCommand:callback => ipcRenderer.on('command',(_event,name) => callback(name)),
  onLoaded:callback => ipcRenderer.on('loaded',(_event,data) => callback(data))
});
