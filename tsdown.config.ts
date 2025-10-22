import { defineConfig } from "tsdown";

export default defineConfig({
    format: "esm",
    dts: true,
    sourcemap: true,
    clean: true,
    minify: false,
    fixedExtension: true,
    hash: false,
    outDir: "dist",
    unbundle: true,
});
