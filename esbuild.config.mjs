import esbuild from "esbuild";

const mode = process.argv[2] ?? "dev";

/** The plugin bundle Obsidian loads. */
const plugin = {
    entryPoints: ["src/obsidian/main.ts"],
    outfile: "main.js",
    bundle: true,
    format: "cjs",
    target: "es2022",
    platform: "browser",
    external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
    sourcemap: mode === "production" ? false : "inline",
    minify: mode === "production",
    logLevel: "info",
};

/** A browser harness that runs the review UI without Obsidian. */
const demo = {
    entryPoints: ["demo/demo.ts"],
    outfile: "demo/dist/demo.js",
    bundle: true,
    format: "iife",
    target: "es2022",
    platform: "browser",
    sourcemap: "inline",
    logLevel: "info",
};

if (mode === "production") {
    await esbuild.build(plugin);
} else if (mode === "demo") {
    await esbuild.build(demo);
} else {
    const ctx = await esbuild.context(plugin);
    await ctx.watch();
}
