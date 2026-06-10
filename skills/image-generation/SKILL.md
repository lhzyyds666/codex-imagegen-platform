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

If a user links an old skill path that no longer exists, locate the active Codex copy before editing or following it. Common migration pattern: `~/.agents/skills/.migrated-to-codex-*` may be stale while the live skill is under `~/.codex/skills/`.

## Route Selection

- Use the installed system `$imagegen` skill for ordinary image generation or image editing.
- Use direct `gpt-image-2-skill` when the user references a local imagegen platform, asks for a project's `quality=high` method, or says the server is unnecessary.
- Find the CLI in this order: current project's `node_modules/gpt-image-2-skill/bin/gpt-image-2-skill.js`, current project's `node_modules/.bin/gpt-image-2-skill`, PATH, then `npx --yes gpt-image-2-skill`.
- Do not start a local platform server just to generate images if the same request can be made through the CLI.
- Default direct CLI generations and edits to `--quality high` unless the user explicitly requests another quality. This is especially important for 4K report, HTML, PPT, screenshot, and diagram assets where text sharpness matters.
- If working in a repo, verify the current route first: search for `quality`, `size`, `generate-codex`, `gpt-image-2-skill`, and the actual CLI arguments.
- If the CLI, Codex auth, and `OPENAI_API_KEY` are all unavailable, explain the missing prerequisite and use the built-in `$imagegen` route only when it satisfies the user's request.
- Use `--provider codex` for the Codex-auth route. If only `OPENAI_API_KEY` is available, switch the CLI examples to the provider supported by the installed tool for OpenAI API mode.
- On Windows PowerShell, call `npx` with an argument array when prompts are long or contain Chinese, quotes, formulas, or newlines. Multi-line here-strings can make `npx.cmd` drop later flags such as `--out` and `--ref-image`; compress prompts to one line or pass an array.
- For the Codex provider, do not pass `--input-fidelity`; that option is OpenAI-provider-only in current `gpt-image-2-skill`. Keep `--quality high`, `--size`, `--background`, and `--format`.

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
  - The current CLI enforces a total-pixel cap around `8294400`; `3840x2880` is rejected even though it is 4:3. For 4:3 source images, generate `3840x2160` and update the consuming layout to avoid distortion, or use deterministic upscaling instead of model regeneration when exact aspect ratio is mandatory.
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

### Windows-safe `npx` invocation

Use this pattern when paths, prompts, or exact text include Chinese characters:

```powershell
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$prompt = 'single-line exact-text prompt with all labels and formulas'
$argsList = @(
  '--yes','gpt-image-2-skill',
  '--json','--json-events','--provider','codex',
  'images','edit',
  '--prompt',$prompt,
  '--ref-image',$ref,
  '--out',$out,
  '--format','png',
  '--size','3840x2160',
  '--quality','high',
  '--background','opaque'
)
& npx @argsList
```

If the command errors that required `--out` or `--ref-image` was not provided, suspect PowerShell/cmd argument parsing first, not missing files.

## DOCX Or Word Embedded Images

When regenerating images extracted from `.docx`:

1. Extract only real `word/media/*` files, skipping folder entries like `word/media/`.
2. Save originals in a named folder and preserve `part`, order, dimensions, byte size, and SHA-256 in a manifest.
3. If the generated image aspect ratio differs from the original, update the Word drawing size (`wp:extent` and matching `a:ext`) when replacing the media. Do not rely on Word to stretch the image correctly.
4. After replacement, verify the package with `zipfile.testzip()`, reopen with `python-docx`, and inspect embedded image dimensions from the ZIP.
5. Preserve the prior DOCX and write a new output name such as `_4K插图版.docx`.

## Local Platform Projects

For projects similar to `codex-imagegen-platform`:

- Prefer the repo's own `package.json` scripts and dependency versions.
- Run `npm install` when `package.json` declares `gpt-image-2-skill` but `node_modules/` is missing.
- Run the repo's quick syntax check, commonly `npm run check`, before changing platform code.
- Keep generated images in the repo's existing output folder, commonly `data/outputs/`, unless the user specifies another destination.

## Enhancement And Text Repair

- First inspect the generated result visually. Text-heavy images need human-visible text QA, not only file-size or dimension checks.
- For exact typo fixes in otherwise good text/vector slides, prefer deterministic local repair such as overlaying corrected text with Pillow/System.Drawing rather than re-running the whole image model.
- On Windows, when deterministic repair overlays Chinese text in a Python script piped through PowerShell, write the Chinese strings as `\uXXXX` escapes or build them with `chr(...)`. Otherwise console encoding can turn repair text into `?????` even when the image generation result was fine.
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
- Passing multi-line Chinese prompts through `npx.cmd` and then misdiagnosing dropped flags as a CLI or auth failure.
- Adding OpenAI-only flags such as `--input-fidelity` to a Codex-provider call.
- Replacing DOCX media without updating image extents, causing stretched or squashed figures.
- Repairing Chinese text overlays through a PowerShell pipe without Unicode escapes, producing `?????` in the image.
- Letting Windows console encoding turn Chinese paths or filenames into `???`.
- Leaving temporary generation scripts or logs in the workspace after tests finish.
