# TUI manual Windows Terminal release gate (product gate G7)

These checks cannot be automated: they require a real interactive terminal on
the target machine (Windows Terminal), a real IME, and live resize and signal
behaviour. They are the authoritative release gate for the thin renderer from
[docs/design/tui-rendering-strategy.md][strategy] section 4 and
[docs/research/deno-tui-candidates.md][research] section 10.2. The automated
suite proves the reducer transitions and the terminal acquire/restore call
sequence; a human confirms the live behaviour below.

Run the TUI from Windows Terminal:

```powershell
npm start
```

`book-title` with no command in a terminal (no `--json`) starts the full-screen
TUI. Every other invocation never acquires the terminal.

## Checklist

- [ ] **Startup / alternate screen.** The TUI opens over the previous
      scrollback on the alternate screen; the cursor is hidden. Quitting (Esc
      at the search screen) restores the prior screen and cursor.
- [ ] **Chinese IME composition.** With Microsoft Pinyin enabled, compose a
      Chinese title, commit it into the search field, delete by committed
      character, move the caret by grapheme, and observe no crash and a
      correct caret column.
- [ ] **Width at 60×16 and 120×40.** Chinese titles, mixed CJK/Latin text, and
      ZWJ emoji fixtures render without truncating mid-grapheme and align to
      the expected columns at both sizes.
- [ ] **Resize through 40×10.** Resize the window 120×40 → 60×16 → 40×10 and
      back; below the 60×16 minimum the renderer shows the resize message and
      never corrupts the layout, and it recovers when the window grows again.
- [ ] **Restoration after Ctrl+C.** Press Ctrl+C while a request is in flight
      and while idle: the terminal is restored (cursor visible, echo on, raw
      mode off, alternate screen left) and the process exits `130`.
- [ ] **Restoration after an uncaught error.** Trigger an unexpected driver
      error path and confirm the cursor, echo, raw mode, and alternate screen
      are restored before the nonzero exit.

## Recording

The human coordinator records each item as pass/fail (with a one-line note for
any failure) on this branch before the TUI is considered releasable. A failed
item reopens the thin-renderer decision (issue #9) with the specific failure;
it must not be silently shipped.

[strategy]: ../../../../docs/design/tui-rendering-strategy.md
[research]: ../../../../docs/research/deno-tui-candidates.md
