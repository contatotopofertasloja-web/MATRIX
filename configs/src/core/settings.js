// Shim de compat: permite import default e nomeados a partir do caminho antigo.
// - default  - - nomeados - do módulo real

export * from '../../../src/core/settings.js';
import { settings } from '../../../src/core/settings.js';
export default settings;

