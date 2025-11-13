await Promise.all(
  (["cjs", "esm"] as const).map(async (format) =>
    Bun.build({
      entrypoints: ["./index.ts"],
      outdir: "./dist",
      target: "node",
      format,
      naming: `[dir]/[name].${format === "esm" ? "js" : "cjs"}`,
    })
  )
);
