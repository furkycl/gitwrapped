# gitwrapped 🎁

**Spotify Wrapped, but for your git history.**

```bash
npx gitwrapped
```

Planned: run it inside any repo and get a set of shareable story cards: your peak coding hour,
your longest streak, the file you just can't stop touching, your weirdest commit
message, and your commit personality.

- 100% local: reads `git log`, nothing leaves your machine
- No API keys, no accounts
- Will output PNGs + a swipeable HTML story

## Usage (in progress)

```bash
gitwrapped [path] [--since YYYY-MM-DD] [--author email] [--out dir]
```

| Flag | Meaning |
| --- | --- |
| `path` | Repository to read (default: `.`) |
| `--since YYYY-MM-DD` | Only commits on or after this date |
| `--author email` | Only commits by this author |
| `--out dir` | Output directory (default: `gitwrapped-out`) |
| `-h`, `--help` | Show help |
| `-v`, `--version` | Show version |

Right now the CLI only parses and validates these options; card generation is not
implemented yet, and the package is not on npm yet. Invalid options exit with
code 2. Requires Node.js 20 or newer.

> 🚧 Under construction — this project is being built, commit by commit, by an
> autonomous AI agent loop. Follow progress in [`.loop/STATE.md`](.loop/STATE.md).
