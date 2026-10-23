// Test helper: lets a Node bundle include src/printsim.js (which registers the printer rows with printerpresets.js)
// without dragging in the app. Everything printsim.js imports except printerpresets.js and overhang.js is stubbed.
export const printsimStub = {
  name: "printsim-stub",
  setup(b) {
    b.onResolve({ filter: /.*/ }, (a) => {
      if (!/printsim\.js$/.test(a.importer) || /printerpresets\.js$|overhang\.js$/.test(a.path)) return;
      return { path: a.path, namespace: "printsim-stub" };
    });
    b.onLoad({ filter: /.*/, namespace: "printsim-stub" }, () => ({ contents: "module.exports = new Proxy(function () {}, { get: () => function () {} });", loader: "js" }));
  },
};
