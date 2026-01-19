# Changesets

This project uses [changesets](https://github.com/changesets/changesets) for version management.

## Adding a changeset

When you make changes that should be released:

```bash
pnpm changeset
```

Follow the prompts to describe your changes.

## Versioning

To update versions based on changesets:

```bash
pnpm changeset:version
```

## Publishing

To publish to npm:

```bash
pnpm changeset:publish
```
