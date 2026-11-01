/// <reference types="vite/client" />
declare module 'monaco-editor/editor/editor.worker.js?worker' {
  const W: { new (): Worker };
  export default W;
}
