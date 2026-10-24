/// <reference types="vite/client" />

declare const __APP_BUILD_ID__: string;

declare module '*.png' {
    const value: string;
    export default value;
}
