import { createCompressorEditor } from './compressor.js';
import { createEqEditor } from './eq.js';

export const EDITORS = {
  compressor: createCompressorEditor,
  eq: createEqEditor
};
