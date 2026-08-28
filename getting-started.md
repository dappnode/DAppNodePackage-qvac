# Configure QVAC

Open the configuration UI after installation:

- CPU package: `qvac.dappnode`
- GPU package: `qvac-gpu.dappnode`

On the hostname for your installed package, the configuration UI uses port `8080`, the OpenAI-compatible API uses `/v1` on port `11434`, and the interactive API documentation is at `/docs` on port `11434`.

QVAC starts with the compact `qwen3-600m` model. Its first download can take several minutes; later starts reuse the persistent model cache.

## CPU and GPU variants

The `qvac.dnp.dappnode.eth` package does not reserve a GPU and therefore starts on CPU-only DAppNodes. CPU inference is slower and needs enough system RAM for the selected model; begin with `qwen3-600m` before loading larger models.

The `qvac-gpu.dnp.dappnode.eth` package reserves every GPU exposed by Docker. Before installing it, confirm that `docker run --rm --gpus all ubuntu:24.04 true` succeeds on the DAppNode host. Use the CPU package if that check fails.

## Choose models

1. Open **Models** in the configuration UI.
2. Select **Browse library**.
3. Search or filter the installed QVAC catalogue and add the models you want.
4. Review which models are defaults or preload at startup.
5. Select **Save & reload**.

Models that do not preload are loaded when first requested. This helps avoid filling the node's memory when several models are configured. Advanced users can add a model URL or local path, edit the complete JSON, or import an existing `qvac.config.json` from the same page.

## Call the API

Use the API key chosen during installation as a Bearer token. Omit the `Authorization` header if no key was configured.

```bash
QVAC_HOST=qvac.dappnode # Use qvac-gpu.dappnode for the GPU package
curl "http://${QVAC_HOST}:11434/v1/chat/completions" \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -d '{
    "model": "qwen3-600m",
    "messages": [{"role": "user", "content": "Explain DAppNode in one sentence."}]
  }'
```

The UI remains available while the QVAC worker reloads or downloads models. It also validates every save and keeps recent configuration backups.
