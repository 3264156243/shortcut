import { contextBridge, ipcRenderer } from 'electron';

const allowedActions = new Set(['copy', 'pin', 'interaction']);

contextBridge.exposeInMainWorld('translationBubble', {
  action: (action: string) => {
    if (allowedActions.has(action)) ipcRenderer.send('translation:bubble-action', action);
  },
});
