/// <reference types="vite/client" />

declare const __APP_BUILD_ID__: string;
declare const __APP_COMMIT__: string;
declare const __APP_BUILT_AT__: string;

declare module '*.png' {
    const value: string;
    export default value;
}
