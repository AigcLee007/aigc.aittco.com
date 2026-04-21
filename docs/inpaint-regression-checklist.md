# Inpaint Regression Checklist

## Core Flow
- Open inpaint panel and select a single image node.
- Draw at least one stroke and submit once.
- Verify loading placeholders are created and receive task IDs.
- Verify stroke overlay is cleared only after at least one task submission succeeds.
- Verify submit button is disabled while request is in progress.

## Error Handling
- Submit with empty prompt and confirm inline validation is shown.
- Submit without API key and confirm inline validation is shown.
- Simulate upstream failure and confirm placeholder node gets error state.
- Simulate partial success (`quantity > 1`) and confirm success count + failure reason are shown.

## Mask Behavior
- Draw near all 4 image edges and verify no stroke points exceed node bounds.
- Draw quickly and confirm no severe frame drops while painting.
- Use `transparent` mask mode and verify output respects punched input.
- Use `binary` mask mode and verify output respects black/white mask.
- Use `undo last stroke` and verify only the last path is removed.
- Use `clear` and verify all strokes are removed.

## Node UX
- During loading, confirm status text includes short task ID suffix.
- Verify tooltip/loading card progress updates as polling progresses.
- Verify failed task transitions from loading to error state.

## Cross-Feature Safety
- Test drag, zoom, and selection still work when inpaint mode is inactive.
- Test image history open/close behavior after an inpaint submission.
- Test mobile touch draw path and pointer-up cleanup.
