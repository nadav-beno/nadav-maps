declare const __APP_VERSION__: string;
declare const __BUILD_TIME__: string;

declare module 'vt-pbf' {
  const vtpbf: { fromGeojsonVt(layers: Record<string, unknown>, options?: { version?: number; extent?: number }): Uint8Array };
  export default vtpbf;
}
