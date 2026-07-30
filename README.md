<div align="center">
  <img src="docs/assets/novus-mark.svg" alt="Novus" width="110" height="97">

  <h1>Novus</h1>

  <p>A desktop ebook reader for people who read a lot.</p>

  <p><a href="https://github.com/Sillyfrogster/novus/releases/latest"><strong>Download the latest release</strong></a></p>
</div>

Novus is the reader I wanted for myself: quiet, quick, and pleasant to spend time in. It's made for keeping a library, returning to unfinished books, and saving the lines worth remembering.

I'm building Novus on my own. It's still young, but the goal is simple: make a reader that feels cared for and gets better through regular use. EPUB is the first format it supports. I don't plan for it to be the last.

## Reading with Novus

Novus keeps your books on your computer and remembers where you left off. You can organize a library into collections, search it, and keep the books you are already reading close at hand.

You can read page by page or in a continuous scroll, with a choice of typefaces, themes, and controls for making the page comfortable. Highlights can carry notes, return you to the original passage, and be copied or exported when you want them elsewhere.

Reading insights show the shape of your habits over time, including time spent reading, pages read, pace, and streaks. They are there for curiosity, not pressure.

## Download

Novus builds are available for macOS, Windows, and Linux on the [Releases page](https://github.com/Sillyfrogster/novus/releases/latest).

> [!NOTE]
> Novus is under active development. Keep your original book files somewhere safe while it grows.

There is no account or cloud library. Your books, reading position, highlights, notes, and reading history stay on your computer. Reading works offline; Novus only goes online to check for updates.

## Development

Novus is built with [Tauri 2](https://v2.tauri.app/), Rust, React, TypeScript, Vite, and Bun. EPUB support comes from [foliate-js](https://github.com/johnfactotum/foliate-js), which is vendored with its license in `vendor/`.

To run it locally, install [Bun](https://bun.sh/), [Rust](https://www.rust-lang.org/tools/install), and the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform.

```bash
git clone https://github.com/Sillyfrogster/novus.git
cd novus
bun install
bun run tauri dev
```

Useful checks:

```bash
bun run build
cd src-tauri && cargo test
```

Build a desktop installer from the project root with:

```bash
bun run tauri build
```

## Feedback

If a book looks wrong, Novus loses your place, or something simply feels awkward, please [open an issue](https://github.com/Sillyfrogster/novus/issues). Those rough edges are often the most useful guide for what to work on next.
