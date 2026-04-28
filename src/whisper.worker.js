import { pipeline, env } from "@huggingface/transformers";

env.allowLocalModels = false;
env.backends.onnx.wasm.numThreads = 1;

let whisperPipeline = null;
let loadedModel = null;

self.onmessage = async ({ data }) => {
  const { type, payload } = data;
  if (type !== "transcribe") return;

  const { url, opts, model, duration } = payload;

  try {
    if (!whisperPipeline || loadedModel !== model) {
      whisperPipeline = null;
      loadedModel = null;
      self.postMessage({ type: "loading" });

      const dlFiles = {};
      whisperPipeline = await pipeline(
        "automatic-speech-recognition",
        model,
        {
          dtype: "q8",
          progress_callback: (p) => {
            if (p.status === "initiate" && p.file) {
              dlFiles[p.file] = { loaded: 0, total: 0 };
            } else if (p.status === "progress" && p.file) {
              dlFiles[p.file] = { loaded: p.loaded || 0, total: p.total || 0 };
              const vals = Object.values(dlFiles);
              const totalLoaded = vals.reduce((s, f) => s + f.loaded, 0);
              const totalSize = vals.reduce((s, f) => s + f.total, 0);
              if (totalSize > 0) {
                const pct = Math.min(
                  Math.round((totalLoaded / totalSize) * 100),
                  95,
                );
                self.postMessage({ type: "download_progress", payload: pct });
              }
            }
          },
        },
      );
      loadedModel = model;
    }

    self.postMessage({ type: "transcribing" });

    // Chunk-level progress: each chunk fires chunk_callback
    const chunkStep =
      (opts.chunk_length_s || 28) - (opts.stride_length_s || 6);
    const totalChunks = Math.max(1, Math.ceil((duration || 60) / chunkStep));
    let processedChunks = 0;

    const result = await whisperPipeline(url, {
      ...opts,
      chunk_callback: () => {
        processedChunks++;
        const pct = Math.min(
          Math.round((processedChunks / totalChunks) * 95),
          95,
        );
        self.postMessage({ type: "trans_progress", payload: pct });
      },
    });

    self.postMessage({ type: "result", payload: result });
  } catch (err) {
    self.postMessage({ type: "error", payload: err.message || String(err) });
  }
};
