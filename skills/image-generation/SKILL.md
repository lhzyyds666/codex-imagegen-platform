---
name: image-generation
description: Use when generating, editing, regenerating, upscaling, enhancing, or extracting images; when the user mentions 生图, 生成图片, 修图, 重绘, 4K, quality=high, gpt-image, screenshots, presentation images, HTML/PPT/report images that need clearer text, or local Codex imagegen platform workflows.
---

# Image Generation

## Core Rule

Act on the concrete artifact. Inspect the input file, image, HTML, project code, or existing outputs before choosing a generation path. Prefer the smallest reliable path that preserves the user's intended layout, text, and provenance.

## First Run Check

If this skill was installed from a GitHub repo and `scripts/check-env.mjs` is present, run it from the target project before using the direct CLI path:

```powershell
# From the installed skill directory:
node ".\scripts\check-env.mjs" "C:\path\to\target-project"

# From a target project that vendors this skill:
node ".\skills\image-generation\scripts\check-env.mjs" .
```

Use the result to choose the route. Do not assume the original author's local paths exist on the user's machine.

## Route Selection

- Use the installed system `$imagegen` skill for ordinary image generation or image editing.
- Use direct `gpt-image-2-skill` when the user references a local imagegen platform, asks for a project's `quality=high` method, or says the server is unnecessary.
- Find the CLI in this order: current project's `node_modules/gpt-image-2-skill/bin/gpt-image-2-skill.js`, current project's `node_modules/.bin/gpt-image-2-skill`, PATH, then `npx --yes gpt-image-2-skill`.
- Do not start a local platform server just to generate images if the same request can be made through the CLI.
- If working in a repo, verify the current route first: search for `quality`, `size`, `generate-codex`, `gpt-image-2-skill`, and the actual CLI arguments.
- If the CLI, Codex auth, and `OPENAI_API_KEY` are all unavailable, explain the missing prerequisite and use the built-in `$imagegen` route only when it satisfies the user's request.
- Use `--provider codex` for the Codex-auth route. If only `OPENAI_API_KEY` is available, switch the CLI examples to the provider supported by the installed tool for OpenAI API mode.

## HTML Or Embedded Image Extraction

When the source is an HTML file with embedded images:

1. Locate the exact file and read it with UTF-8-safe paths. On Windows, pass Chinese paths through environment variables or use UTF-8 PowerShell output.
2. Extract every `data:image/...;base64,...` image into a run folder such as `data/outputs/<slug>/originals/`.
3. Preserve image order, `alt` text, dimensions, byte size, and source path in a manifest.
4. If the HTML has no extra text beyond image `alt` labels, treat the images themselves as the source of truth and visually inspect them.

## Regeneration And Editing

- For slide/report/diagram images, prefer image-to-image editing over prompt-only generation.
- Preserve layout, dates, numbers, chart values, labels, colors, and icons unless the user asks to redesign them.
- Put all critical text in the prompt as an exact-text list. For Chinese academic slides, include titles, dates, metrics, chart labels, and English tokens exactly.
- Use 4K dimensions explicitly:
  - 16:9 horizontal: `3840x2160`
  - 9:16 vertical: `2160x3840`
- For a direct CLI path, pass the parameters directly. Choose the first command form that matches the environment check:

```powershell
# Local project script:
node ".\node_modules\gpt-image-2-skill\bin\gpt-image-2-skill.js" `
  --json --json-events --provider codex `
  images edit `
  --prompt "<prompt>" `
  --ref-image "<input.png>" `
  --out "<output.png>" `
  --format png `
  --size 3840x2160 `
  --quality high `
  --background opaque

# PATH binary:
gpt-image-2-skill `
  --json --json-events --provider codex `
  images edit `
  --prompt "<prompt>" `
  --ref-image "<input.png>" `
  --out "<output.png>" `
  --format png `
  --size 3840x2160 `
  --quality high `
  --background opaque

# One-shot npx fallback:
npx --yes gpt-image-2-skill `
  --json --json-events --provider codex `
  images edit `
  --prompt "<prompt>" `
  --ref-image "<input.png>" `
  --out "<output.png>" `
  --format png `
  --size 3840x2160 `
  --quality high `
  --background opaque
```

When using a discovered `.js` script path, invoke it with `node`.

- If the provider's SSE/tool log echoes `quality: auto` despite receiving `--quality high`, note it as provider mapping behavior; keep the transmitted CLI args in the manifest.

## Local Platform Projects

For projects similar to `codex-imagegen-platform`:

- Prefer the repo's own `package.json` scripts and dependency versions.
- Run `npm install` when `package.json` declares `gpt-image-2-skill` but `node_modules/` is missing.
- Run the repo's quick syntax check, commonly `npm run check`, before changing platform code.
- Keep generated images in the repo's existing output folder, commonly `data/outputs/`, unless the user specifies another destination.

## Enhancement And Text Repair

- First inspect the generated result visually. Text-heavy images need human-visible text QA, not only file-size or dimension checks.
- For exact typo fixes in otherwise good text/vector slides, prefer deterministic local repair such as overlaying corrected text with Pillow/System.Drawing rather than re-running the whole image model.
- Preserve originals. Write enhanced outputs beside them with clear suffixes such as `_4k_quality-high`, `_text-fixed`, or `_enhanced`.
- For screenshots and presentation assets, favor crisp PNG output, sharp readable text, and minimal compression artifacts.
- For batch jobs, process serially unless the tool and output manifest are designed for parallel writes.

## Verification

Before saying done:

- Verify output count matches requested count.
- Verify PNG dimensions by reading the header, not by trusting filenames.
- Open or view every final image and check the main text, dates, numbers, labels, and obvious spelling.
- Write a final manifest with source file, original folder, final folder, method, size, quality, and any postprocess fixes.
- Delete temporary scripts, pid files, logs, and scratch outputs once verification passes.
- If a dev server or background generation process was started, stop it before finishing.
- If work happened in a git repo, run `git status --short` and ensure only intended non-ignored files changed.

## Common Mistakes

- Starting the server when the direct image skill call is enough.
- Trusting generated text without visual inspection.
- Re-running a full image generation for one tiny text typo.
- Letting Windows console encoding turn Chinese paths or filenames into `???`.
- Leaving temporary generation scripts or logs in the workspace after tests finish.
