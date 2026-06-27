<div align="center">
  <img src="docs/assets/novus-mark.svg" alt="Novus" width="110" height="97">

  <h3>Novus</h3>

  <p>A desktop ebook reader for people who read a lot.</p>

  <sub>Version 0.1.0 · early, pre-release</sub>
</div>

## About

Novus is a desktop ebook reader. Most readers ask you to pick a side: the quick ones tend to look dated, and the good-looking ones tend to run heavy. Novus is built to be both at once, fast to open and clean to sit in for a few hours.

It runs on your machine, offline. Your books and your place in them stay local. The core is Rust through Tauri, not a bundled browser, so it starts quickly and stays light while it is open.

It is free to use. A paid tier (one-time, with an optional account) is planned later.

## Usage

Download the latest build for your platform from the [Releases page](https://github.com/Sillyfrogster/novus/releases), then open it and add books from your disk. Your library lives locally; nothing about what you read leaves your machine.

## Built with

Tauri, Rust, React, TypeScript, and Vite. Ebook formats are parsed and rendered by [foliate-js](https://github.com/johnfactotum/foliate-js) (MIT) by John Factotum, which bundles [pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0) by Mozilla. Both are vendored under `vendor/` with their licenses kept in place.

## License

Novus is licensed under the [MIT License](LICENSE).

The third-party components in `vendor/` keep their own licenses (foliate-js is MIT, pdf.js is Apache-2.0).

## Contact

[@Sillyfrogster](https://github.com/Sillyfrogster) on GitHub.
