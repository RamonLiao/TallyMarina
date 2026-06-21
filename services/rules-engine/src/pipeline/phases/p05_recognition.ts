import type { Phase } from '../context.js';

export const phaseRecognition: Phase = (ctx) => { ctx.carry.recognize = true; return null; };
