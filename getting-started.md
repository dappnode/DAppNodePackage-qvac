# Configure QVAC

Open the configuration UI after installation:

- Configuration UI: `http://qvac.dappnode:8080`
- OpenAI-compatible API: `http://qvac.dappnode:11434/v1`
- Interactive API documentation: `http://qvac.dappnode:11434/docs`

QVAC starts with the compact `qwen3-600m` model. Its first download can take several minutes; later starts reuse the persistent model cache.

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
curl http://qvac.dappnode:11434/v1/chat/completions \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer YOUR_API_KEY' \
  -d '{
    "model": "qwen3-600m",
    "messages": [{"role": "user", "content": "Explain DAppNode in one sentence."}]
  }'
```

The UI remains available while the QVAC worker reloads or downloads models. It also validates every save and keeps recent configuration backups.
