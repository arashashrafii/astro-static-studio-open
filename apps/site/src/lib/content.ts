import data from '../../../../content/content.json';
import { importContent } from '@astro-static-studio/contracts/migration';

/** Static rendering always receives the single current content model. */
export async function content(){ return importContent(data); }
