# Performance results (phase 9)

BranchChat has **no product limits** on discussion size, message count, images or file size (NFR-015). This pass
records how the application behaves, and the automated test fails only on gross regressions.

Measured by `tests/e2e/performance.spec.ts` on a Linux CI-class container (Electron 45, software rendering, no GPU).
A Windows laptop with a real GPU is usually faster for painting and slower for disk; repeat the run on the oldest
supported machine (see `windows-test-checklist.md`, section I) and add the numbers here.

| Scenario                                                   | Result             |
|------------------------------------------------------------|--------------------|
| Start window (launch to usable)                            | 0.74 s             |
| Open 5,000 messages (63 KB file): launch to first message  | 0.77 s             |
| 5,000 messages: send a message (visible / saved in file)   | 0.15 s / 0.18 s    |
| Open 20,000 messages (251 KB file)                         | 1.3 s              |
| 20,000 messages: send a message (visible / saved in file)  | 0.39 s / 0.49 s    |
| Message rows kept in the page (any size)                   | 16 (virtualized)   |
| 300 images (640×480) in one discussion: open               | 0.75 s             |
| 300 images: scroll the whole list in 40 steps              | 2.0 s              |
| 17 MB picture: staging from the clipboard path             | 0.07 s             |
| Memory (all processes): start / 20,000 messages / 300 imgs | 460 / 680 / 550 MB |

## What was done

- The message list is virtualized: the page holds about 16 messages however long the discussion is.
- After a save, only the **status** ("Сохранено") is pushed to the window, not the whole discussion. Before this change
  sending at 20,000 messages copied the full view twice (about 40 ms each) plus the window's own processing.
- Saving is queued and atomic (temporary file, then rename). Autosave never blocks typing.

## Known cost and possible future work

- Each change still sends the complete discussion view to the window (linear in the number of messages). At 20,000
  messages this costs a fraction of a second. If much larger discussions matter, send deltas instead of the whole view.
- Whole-file rewrite on every save: a discussion with hundreds of megabytes of images is rewritten each time. Images
  are stored by content hash, so a future version could append instead of rewriting.
