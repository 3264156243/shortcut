# ShortCut

ShortCut is a Windows desktop quick panel for launching applications, folders, files, and URLs from one focused workspace. It is built with Electron, React, TypeScript, Vite, Zustand, Framer Motion, and Tailwind CSS.

## Features

- Global hotkey panel toggle, defaulting to `Alt+Space`
- Shortcut management for apps, folders, files, and web URLs
- Tabs and groups for organizing shortcuts
- Search across shortcut names, paths, and notes
- Drag-and-drop sorting and grouping
- Tray resident mode
- Dark, light, and system theme modes
- Import and export of local JSON configuration
- Installed software import helper on Windows

## Requirements

- Windows
- Node.js
- npm

## Development

Install dependencies:

```bash
npm install
```

Run the renderer in Vite:

```bash
npm run dev
```

Run the Electron app in development mode:

```bash
npm run electron:dev
```

## Build

Build the renderer:

```bash
npm run build
```

Build the Windows Electron package:

```bash
npm run electron:build
```

Build an unpacked Windows directory:

```bash
npm run electron:build:dir
```

## Project Structure

```text
electron/        Electron main process and preload bridge
src/             React renderer source
src/components/  UI components
src/store/       Zustand application state
src/i18n/        Localized text
resources/       App icons and static resources
```

## Configuration

At runtime, ShortCut stores user configuration under Electron's `userData` directory. The main configuration file is written atomically as JSON.

## License

MIT
