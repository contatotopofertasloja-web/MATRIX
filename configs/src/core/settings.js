// Shim de compatibilidade para imports antigos:
//   import { settings } from 'configs/src/core/settings.js'
// Redireciona para o m¢dulo real em src/core/settings.js.
export * from '../../../src/core/settings.js';
export { default } from '../../../src/core/settings.js';
