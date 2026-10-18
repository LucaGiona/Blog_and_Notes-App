// Welcher Speicher?
//
//   Server erreichbar                    -> syncStore (normal, mit Postausgang)
//   kein Netz                            -> syncStore (liest Zwischenspeicher, Postausgang)
//   lokal (Live Server) ohne PHP-Backend -> localStore: Browser-Speicher, ohne Login – nur zum Testen
//   online ohne funktionierendes Backend -> syncStore (zeigt Fehler, niemand kann schreiben)
//
// Der Browser-Speicher ohne Login ist online also NIE möglich.

import { localStore } from './local.js';
import { serverStatus } from './api.js';
import { syncStore } from './sync.js';
import { isLocalDev } from '../device.js';

export async function createStore() {
  const status = await serverStatus();
  if (status === 'no-backend' && isLocalDev) return localStore;
  return syncStore;
}
