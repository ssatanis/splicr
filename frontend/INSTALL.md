# Frontend install

## If you get "JavaScript heap out of memory" during install

This app has a large dependency tree (including Electron). Use **npm** with more memory:

```bash
# From frontend directory:
NODE_OPTIONS=--max-old-space-size=8192 npm ci
```

Or run the helper script (after any partial install):

```bash
npm run install:fix-oom
```

Then run the app with `npm run dev` or `npm run build` as usual.

## Normal install

```bash
npm ci
# or
npm install
```
