export interface SetupOptions {
  command?: string;
  schemes: string[];
  httpsHosts: string[];
  root: string;
}
export function parseArgs(argv: string[]): SetupOptions;
export function activitiesBlock(schemes: string[], httpsHosts: string[]): string;
export const QUERIES_BLOCK: string;
export function patchManifest(xml: string, schemes: string[], httpsHosts: string[]): string;
export function setup(options: SetupOptions): string[];
