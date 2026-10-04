# gitwrapped 🎁

[![CI](https://github.com/furkycl/gitwrapped/actions/workflows/ci.yml/badge.svg)](https://github.com/furkycl/gitwrapped/actions/workflows/ci.yml)

**Spotify Wrapped, but for your git history.**

```bash
npx gitwrapped
```

**Planned:** run it inside any repo and get a set of shareable story cards: your peak coding hour,
your longest streak, the file you just can't stop touching, your weirdest commit
message, and your commit personality.

- 100% local: reads `git log`, nothing leaves your machine
- No API keys, no accounts
- Outputs PNGs + a swipeable HTML story

## Usage (in progress)

```bash
gitwrapped [path] [--since YYYY-MM-DD] [--author email] [--out dir]
gitwrapped --help      # -h
gitwrapped --version   # -v
```

Right now the CLI only parses and validates these flags (`path` defaults to `.`,
`--out` defaults to `gitwrapped-out`; `--author` matches the commit author's email
exactly, case-insensitive). It does **not** analyze your history or write
any cards yet; it just prints what it would do. Requires Node.js >= 20.

> 🚧 Under construction — this project is being built, commit by commit, by an
> autonomous AI agent loop. Follow progress in [`.loop/STATE.md`](.loop/STATE.md).
